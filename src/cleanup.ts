/** 附件清理策略（2+3 联动）：
 * - 2 会话级联：会话被删除后，其关联记录与所引用（且无其他会话引用）的字节一并清理
 * - 3 自动 GC：老化(超过 maxAgeDays 未 read/download) + 容量(超过 maxCacheBytes 按 LRU 优先删最久未访问)
 * 所有清理只删「字节」，保留关联记录 + 会话气泡（下载按钮在字节消失时置灰/隐藏）。
 */

import type { FileAttachmentStore } from './store.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface CleanupConfig {
  /** 是否启用自动 GC。 */
  enabled: boolean
  /** 超过该天数未被内容读取(store.read)的附件字节会被清理（0 = 关闭老化清理）。默认 30 天。 */
  maxAgeDays: number
  /** 附件库总字节上限；超出后按 LRU 删最久未访问（0 = 不限制）。默认 500 MB。 */
  maxCacheBytes: number
  /** GC 定时检查间隔（小时）。默认 24 小时。 */
  gcIntervalHours: number
}

const CLEANUP_CONFIG_PATH = join(homedir(), '.dsh', 'filefix-cleanup.json')

const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  enabled: true,
  maxAgeDays: 30,
  maxCacheBytes: 0,
  gcIntervalHours: 24,
}

export function readCleanupConfig(): CleanupConfig {
  try {
    if (existsSync(CLEANUP_CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CLEANUP_CONFIG_PATH, 'utf8')) as Partial<CleanupConfig>
      return { ...DEFAULT_CLEANUP_CONFIG, ...parsed }
    }
  } catch { /* 配置损坏按默认处理 */ }
  return { ...DEFAULT_CLEANUP_CONFIG }
}

export function writeCleanupConfig(config: Partial<CleanupConfig>): void {
  const merged = { ...readCleanupConfig(), ...config }
  writeFileSync(CLEANUP_CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

export interface CleanupStats {
  enabled: boolean
  maxAgeDays: number
  maxCacheBytes: number
  gcIntervalHours: number
  manifestCount: number
  associationCount: number
  totalBytes: number
}

export interface CleanupRunResult {
  removedBlobs: number
  removedBytes: number
  removedAssociations: number
  skipped: boolean
}

/** 本次运行访问时间戳（write-through 到 manifest 行）。 */
const accessCache = new Map<string, number>()

/**
 * 执行一轮清理。返回值供 remote 层回显 & 日志。
 * skipped=true 表示未开启自动 GC（enabled=false）。
 */
export async function runCleanup(store: FileAttachmentStore): Promise<CleanupRunResult> {
  const result: CleanupRunResult = { removedBlobs: 0, removedBytes: 0, removedAssociations: 0, skipped: false }
  const config = readCleanupConfig()
  if (!config.enabled) {
    result.skipped = true
    return result
  }
  try {
    // 关联记录（含 sessionId）→ 统计每个 attachmentId 被多少条活会话消息引用。
    const records = await store.loadAssociationRecords()
    const refCount = new Map<string, number>()
    for (const rec of records) {
      for (const file of rec.files) {
        refCount.set(file.attachmentId, (refCount.get(file.attachmentId) ?? 0) + 1)
      }
    }

    const manifest = await store.list()
    const now = Date.now()
    const ageCut = config.maxAgeDays > 0 ? now - config.maxAgeDays * 24 * 3600 * 1000 : 0

    // 候选删除：影子(manifest 有、关联 0 引用) 或 老化(超时未读)。
    const doomed = new Set<string>()
    const doomedBytesTotal: Record<string, number> = {}
    for (const row of manifest) {
      const objectExists = await store.hasBytes(row.attachmentId)
      if (!objectExists) {
        doomed.add(row.attachmentId) // 对象已不存在，仅清理 manifest 残影行
        continue
      }
      const refs = refCount.get(row.attachmentId) ?? 0
      const lastAccess = accessCache.get(row.attachmentId) ?? row.createdAt
      if (refs === 0 || (ageCut !== 0 && lastAccess < ageCut)) {
        doomed.add(row.attachmentId)
        doomedBytesTotal[row.attachmentId] = row.size
      }
    }

    // 容量超限：超出部分按 LRU（最久未访问）补删。
    if (config.maxCacheBytes > 0) {
      let reachable = 0
      for (const row of manifest) {
        if (!doomed.has(row.attachmentId)) reachable += row.size
      }
      if (reachable > config.maxCacheBytes) {
        const overage = reachable - config.maxCacheBytes
        const candidates = manifest
          .filter(row => !doomed.has(row.attachmentId))
          .sort((a, b) => {
            const aA = accessCache.get(a.attachmentId) ?? a.createdAt
            const bA = accessCache.get(b.attachmentId) ?? b.createdAt
            return aA - bA
          })
        let freed = 0
        for (const row of candidates) {
          if (freed >= overage) break
          doomed.add(row.attachmentId)
          doomedBytesTotal[row.attachmentId] = row.size
          freed += row.size
        }
      }
    }

    if (doomed.size > 0) {
      const ids = [...doomed]
      result.removedBlobs += await store.deleteBlobs(ids)
      for (const id of ids) {
        result.removedBytes += doomedBytesTotal[id] ?? 0
        accessCache.delete(id)
      }
    }

    // 会话级联（2 联动）：删除不属于任何现存会话的关联记录，
    // 其独有引用（refCount===1）的字节一并删除；多会话共享的保留。
    const knownSessions = await knownLiveSessions()
    if (knownSessions !== null) {
      const kept = records.filter(rec => rec.sessionId !== undefined && knownSessions.has(rec.sessionId))
      if (kept.length !== records.length) {
        await store.rewriteAssociations(kept)
        result.removedAssociations = records.length - kept.length
        const cascadeIds = new Set<string>()
        for (const rec of records) {
          if (rec.sessionId === undefined || !knownSessions.has(rec.sessionId)) {
            for (const file of rec.files) cascadeIds.add(file.attachmentId)
          }
        }
        const cascadeTargets = [...cascadeIds].filter(id => (refCount.get(id) ?? 0) <= 1)
        if (cascadeTargets.length > 0) {
          result.removedBlobs += await store.deleteBlobs(cascadeTargets)
        }
      }
    }

    return result
  } catch (error) {
    result.skipped = true
    throw error
  }
}

/** 会话级联的会话集合：由 host 层注入 sessionPersistence 列表提供者。 */
type SessionLister = () => Promise<readonly { id: unknown }[]>
let sessionLister: SessionLister | undefined

export function setSessionLister(lister: SessionLister): void {
  sessionLister = lister
}

async function knownLiveSessions(): Promise<Set<string> | null> {
  if (sessionLister === undefined) return null
  try {
    const headers = await sessionLister()
    return new Set(headers.map(h => String(h.id)))
  } catch {
    return null
  }
}

export async function cleanupStatsOf(store: FileAttachmentStore): Promise<CleanupStats> {
  const config = readCleanupConfig()
  const records = await store.loadAssociationRecords()
  const manifest = await store.list()
  return {
    enabled: config.enabled,
    maxAgeDays: config.maxAgeDays,
    maxCacheBytes: config.maxCacheBytes,
    gcIntervalHours: config.gcIntervalHours,
    manifestCount: manifest.length,
    associationCount: records.length,
    totalBytes: await store.totalBytes(),
  }
}

/** 记一次内容读取（老化判定的最后访问时间）。 */
export function touchAccess(attachmentId: string): void {
  accessCache.set(attachmentId, Date.now())
}

/** 宿主路径（db 数据目录），供测试引用。 */
export function cleanupConfigPath(): string {
  return CLEANUP_CONFIG_PATH
}

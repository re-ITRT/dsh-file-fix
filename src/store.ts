/** 附件库：内容寻址对象存储 + JSONL 清单。真正的上传 —— 字节入库，不依赖工作区。 */

import { createHash } from 'node:crypto'
import { mkdir, open, readFile, unlink, rename, appendFile, stat as statFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { UploadedFile } from './types.ts'

export interface ManifestRow {
  attachmentId: string
  name: string
  mediaType: string
  size: number
  sessionId: string
  createdAt: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    filefixStore: FileAttachmentStore
  }
}

/** 清单行里保留的最小字段集（与 UploadedFile 对齐）。 */
function toUploadedFile(row: ManifestRow): UploadedFile {
  return { attachmentId: row.attachmentId, name: row.name, mediaType: row.mediaType, size: row.size }
}

/**
 * 内容寻址附件库服务（service key `filefixStore`）。对象布局与官方图片附件
 * 同思路（objects/<sha前2>/<sha>），但独占 uploadux 根目录与清单，互不干扰。
 */
export class FileAttachmentStore extends Service {
  readonly root: string
  readonly objectsDir: string
  readonly manifestPath: string
  readonly associationsPath: string

  constructor(ctx: Context, config: { home?: string } = {}) {
    super(ctx, 'filefixStore')
    this.root = resolve(join(config.home ?? dshHomePath(), 'attachments', 'filefix'))
    this.objectsDir = join(this.root, 'objects')
    this.manifestPath = join(this.root, 'manifest.jsonl')
    this.associationsPath = join(this.root, 'associations.jsonl')
  }

  /** 写入字节并登记清单。重复内容共享同一对象（O_EXCL 幂等）。 */
  async save(input: {
    name: string
    mediaType: string
    sessionId: string
    bytes: Buffer
  }): Promise<UploadedFile> {
    const digest = createHash('sha256').update(input.bytes).digest('hex')
    const objectDir = join(this.objectsDir, digest.slice(0, 2))
    const objectPath = join(objectDir, digest)
    await mkdir(objectDir, { recursive: true })
    try {
      await writeExclusive(objectPath, input.bytes)
    } catch (error) {
      // 内容相同则对象已存在 —— 内容寻址下视为成功。
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const row: ManifestRow = {
      attachmentId: digest,
      name: input.name,
      mediaType: input.mediaType,
      size: input.bytes.byteLength,
      sessionId: input.sessionId,
      createdAt: Date.now(),
    }
    await appendManifest(this.manifestPath, row)
    return toUploadedFile(row)
  }

  /** 按 attachmentId 读字节；不存在返回 undefined。 */
  async read(attachmentId: string): Promise<{ row: ManifestRow; bytes: Buffer } | undefined> {
    const row = (await this.list()).find(item => item.attachmentId === attachmentId)
    if (row === undefined) return undefined
    const objectPath = join(this.objectsDir, attachmentId.slice(0, 2), attachmentId)
    try {
      const bytes = await readFile(objectPath)
      return { row, bytes }
    } catch {
      return undefined
    }
  }

  /** 全量清单（按写入顺序）。 */
  async list(): Promise<ManifestRow[]> {
    try {
      const text = await readFile(this.manifestPath, 'utf8')
      const rows: ManifestRow[] = []
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const parsed = JSON.parse(line) as ManifestRow
          if (typeof parsed.attachmentId === 'string') rows.push(parsed)
        } catch {
          // 半行脏数据跳过（追加式日志容忍尾部损坏）。
        }
      }
      return rows
    } catch {
      return []
    }
  }

  /** 从清单移除登记。对象本体保留（内容寻址可共享；GC 超出 v1 范围）。 */
  async remove(attachmentId: string): Promise<boolean> {
    const rows = await this.list()
    const kept = rows.filter(row => row.attachmentId !== attachmentId)
    if (kept.length === rows.length) return false
    const tmp = `${this.manifestPath}.tmp`
    await writeManifest(tmp, kept)
    await rename(tmp, this.manifestPath)
    // 对象若不被任何清单行引用则一并删除。
    if (!kept.some(row => row.attachmentId === attachmentId)) {
      const objectPath = join(this.objectsDir, attachmentId.slice(0, 2), attachmentId)
      await unlink(objectPath).catch(() => {})
    }
    return true
  }

  /** 附件对象流（下载路由用）。 */
  openStream(attachmentId: string) {
    const objectPath = join(this.objectsDir, attachmentId.slice(0, 2), attachmentId)
    return createReadStream(objectPath)
  }

  /**
   * 消息→附件 关联记录持久化（independent of object bytes）：即使 object 被 GC/迁移
   * 清理，历史会话仍能列出文件名/大小/下载意图；重启后 rebuild 从记录恢复。
   * 追加写，load 时同 messageId 后写覆盖（last-wins）。
   */
  /** 保存一条关联记录（messageId → {seq, files, sessionId}）。 */
  async saveAssociation(
    messageId: string,
    sessionId: string,
    seq: number,
    files: UploadedFileLike[],
  ): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true })
      await appendFile(
        this.associationsPath,
        `${JSON.stringify({ messageId, sessionId, seq, files } satisfies AssociationRecord)}\n`,
        'utf8',
      )
    } catch (error) {
      // 记录失败不影响主流程（attached 内存仍可用）。
    }
  }

  /** 加载全部关联记录（last-wins 覆盖同 messageId）。 */
  async loadAssociations(): Promise<Map<string, { seq: number; files: UploadedFileLike[] }>> {
    const map = new Map<string, { seq: number; files: UploadedFileLike[] }>()
    for (const rec of await this.loadAssociationRecords()) {
      map.set(rec.messageId, { seq: rec.seq ?? -1, files: rec.files })
    }
    return map
  }

  /** 加载全部关联记录（含 sessionId，供 GC 会话级联使用）。 */
  async loadAssociationRecords(): Promise<AssociationRecord[]> {
    const records: AssociationRecord[] = []
    try {
      const text = await readFile(this.associationsPath, 'utf8')
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const rec = JSON.parse(line) as AssociationRecord
          if (typeof rec.messageId === 'string' && Array.isArray(rec.files)) {
            records.push(rec)
          }
        } catch {
          // 半行脏数据跳过
        }
      }
    } catch {
      // 文件不存在 → 空
    }
    return records
  }

  /** 全量重写关联记录（GC / 会话级联后清理孤儿会话的记录）。 */
  async rewriteAssociations(records: readonly AssociationRecord[]): Promise<void> {
    const tmp = `${this.associationsPath}.tmp`
    await writeLines(tmp, records.map(rec => JSON.stringify({
      messageId: rec.messageId,
      sessionId: rec.sessionId,
      seq: rec.seq,
      files: rec.files,
    } satisfies AssociationRecord)))
    await rename(tmp, this.associationsPath).catch(() => {})
  }

  /**
   * 删除一批附件的对象字节 + 清单登记，但保留关联记录（历史气泡仍显示文件名/下载意图）。
   * 返回实际删除的对象数。
   */
  async deleteBlobs(attachmentIds: readonly string[]): Promise<number> {
    if (attachmentIds.length === 0) return 0
    const drop = new Set(attachmentIds)
    const rows = (await this.list()).filter(row => !drop.has(row.attachmentId))
    const tmp = `${this.manifestPath}.tmp`
    await writeManifest(tmp, rows)
    await rename(tmp, this.manifestPath).catch(() => {})
    let removed = 0
    for (const attachmentId of attachmentIds) {
      const objectPath = join(this.objectsDir, attachmentId.slice(0, 2), attachmentId)
      await unlink(objectPath).then(() => removed++).catch(() => {})
    }
    return removed
  }

  /** 一个对象字节是否仍存在（下载按钮可用性判定）。 */
  async hasBytes(attachmentId: string): Promise<boolean> {
    const row = (await this.list()).find(item => item.attachmentId === attachmentId)
    if (row === undefined) return false
    const objectPath = join(this.objectsDir, attachmentId.slice(0, 2), attachmentId)
    try {
      await readFile(objectPath)
      return true
    } catch {
      return false
    }
  }

  /** 对象字节总大小（GB/CB 阈值判定）。 */
  async totalBytes(): Promise<number> {
    const rows = await this.list()
    let total = 0
    for (const row of rows) {
      const objectPath = join(this.objectsDir, row.attachmentId.slice(0, 2), row.attachmentId)
      try {
        const stat = await statFile(objectPath)
        total += stat.size
      } catch {
        // 对象缺失不计（清单残影）
      }
    }
    return total
  }
}

/** 关联记录的最小文件形状（存储校验用；与 UploadedFile 对齐）。 */
export interface UploadedFileLike {
  attachmentId: string
  name: string
  mediaType: string
  size: number
}

export interface AssociationRecord {
  messageId: string
  /** 所属会话（GC 会话级联/孤儿判定用；旧记录可能缺失 → 无级联可做）。 */
  sessionId?: string
  seq: number
  files: UploadedFileLike[]
}

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(bytes)
  } finally {
    await handle.close()
  }
}

async function appendManifest(path: string, row: ManifestRow): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(JSON.stringify(row) + '\n')
  } finally {
    await handle.close()
  }
}

async function writeManifest(path: string, rows: readonly ManifestRow[]): Promise<void> {
  const handle = await open(path, 'w')
  try {
    for (const row of rows) await handle.writeFile(JSON.stringify(row) + '\n')
  } finally {
    await handle.close()
  }
}

/** 原子写多行（附带 .tmp 文件，供 rewriteAssociations 使用）。 */
async function writeLines(path: string, lines: readonly string[]): Promise<void> {
  const handle = await open(path, 'w')
  try {
    for (const line of lines) await handle.writeFile(line + '\n')
  } finally {
    await handle.close()
  }
}

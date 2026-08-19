/** 设置 → 附件清理：GC 阈值配置（2+3 联动）+ 手动清理 + 当前占用统计。 */
/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { UploadRemote } from './remote.ts'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

interface CleanupCfg {
  enabled: boolean
  maxAgeDays: number
  maxCacheBytes: number
  gcIntervalHours: number
}
interface CleanupStats {
  manifestCount: number
  associationCount: number
  totalBytes: number
}

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 16px', maxWidth: 480 } as CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: 8 } as CSSProperties,
  label: { width: 120, color: 'var(--dsw-alias-label-primary)', fontSize: 13, flex: 'none' } as CSSProperties,
  input: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l4)',
    background: 'var(--dsw-alias-bg-l3)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
  } as CSSProperties,
  hint: { color: 'var(--dsw-alias-label-caption)', fontSize: 12 } as CSSProperties,
  badge: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 4,
    border: '1px solid var(--dsw-alias-border-l4)',
    color: 'var(--dsw-alias-label-caption)',
  } as CSSProperties,
  badgeOk: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 4,
    color: '#0a7d33',
    background: 'rgba(10,125,51,0.12)',
  } as CSSProperties,
  badgeBad: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 4,
    color: '#b42318',
    background: 'rgba(180,35,24,0.12)',
  } as CSSProperties,
  button: {
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l4)',
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 13,
  } as CSSProperties,
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function RetentionSettingsSection(_props: SettingsSectionOwnerProps): ReactElement {
  const [cfg, setCfg] = useState<CleanupCfg | null>(null)
  const [stats, setStats] = useState<CleanupStats | null>(null)
  const [saved, setSaved] = useState(false)
  const [warn, setWarn] = useState('')
  const [cleanupMsg, setCleanupMsg] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const [upload, setUpload] = useState<UploadRemote | null>(null)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const u = await getRetentionUpload()
      if (disposed || u === null) return
      setUpload(u)
      const c = await u.getCleanupConfig()
      if (c.ok) setCfg(c.value.config)
      const st = await u.getCleanupStats()
      if (st.ok) setStats(st.value.stats)
    })()
    return () => { disposed = true }
  }, [])

  const refreshStats = async (): Promise<void> => {
    if (upload === null) return
    const st = await upload.getCleanupStats()
    if (st.ok) setStats(st.value.stats)
  }

  const save = async (): Promise<void> => {
    if (upload === null || cfg === null) return
    const maxAge = Number.isFinite(cfg.maxAgeDays) ? Math.max(0, cfg.maxAgeDays) : 30
    const cap = Number.isFinite(cfg.maxCacheBytes) ? Math.max(0, cfg.maxCacheBytes) : 0
    try {
      await upload.setCleanupConfig({
        config: {
          enabled: cfg.enabled,
          maxAgeDays: maxAge,
          maxCacheBytes: cap,
          gcIntervalHours: Number.isFinite(cfg.gcIntervalHours) ? Math.max(1, cfg.gcIntervalHours) : 24,
        },
      })
      setCfg({ ...cfg, maxAgeDays: maxAge, maxCacheBytes: cap })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (error) {
      setWarn(String(error))
    }
  }

  const cleanupNow = async (): Promise<void> => {
    if (upload === null) return
    setCleaning(true)
    setCleanupMsg('')
    setWarn('')
    try {
      const r = await upload.runCleanup()
      if (r.ok) {
        const res = r.value.result
        setCleanupMsg(
          res.skipped
            ? '自动清理未启用（设置页已关闭），未清理'
            : `已清理 ${res.removedBlobs} 个附件（${fmtBytes(res.removedBytes)}）、${res.removedAssociations} 条会话记录`,
        )
        await refreshStats()
      } else {
        setWarn('清理调用失败')
      }
    } catch (error) {
      setWarn(String(error))
    } finally {
      setCleaning(false)
    }
  }

  if (cfg === null) {
    return (
      <div style={s.wrap}>
        <div style={s.hint}>读取附件清理配置…</div>
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <div style={s.hint}>
        附件在会话历史中会一直保留「记录」（文件名/大小/下载意图），但字节会在满足条件时自动清理（引用计数 +
        老化 / 容量超限）。清理后历史文件列表仍显示，下载按钮消失。阈值可在这里自定义。
      </div>
      <div style={s.row}>
        <label style={s.label}>自动清理</label>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}
        />
      </div>
      <div style={s.row}>
        <label style={s.label}>清理前保留天数</label>
        <input
          style={s.input}
          type="number"
          min={0}
          value={String(cfg.maxAgeDays)}
          onChange={e => setCfg({ ...cfg, maxAgeDays: Number(e.target.value) || 0 })}
        />
      </div>
      <div style={s.row}>
        <label style={s.label}>容量上限 (MB, 0=不限)</label>
        <input
          style={s.input}
          type="number"
          min={0}
          value={String(Math.round(cfg.maxCacheBytes / (1024 * 1024)))}
          onChange={e => setCfg({ ...cfg, maxCacheBytes: (Number(e.target.value) || 0) * 1024 * 1024 })}
        />
      </div>
      <div style={s.row}>
        <label style={s.label}>检查间隔 (小时)</label>
        <input
          style={s.input}
          type="number"
          min={1}
          value={String(cfg.gcIntervalHours)}
          onChange={e => setCfg({ ...cfg, gcIntervalHours: Number(e.target.value) || 1 })}
        />
      </div>
      {stats !== null && (
        <div style={s.hint}>
          当前占用：{fmtBytes(stats.totalBytes)}，{stats.manifestCount} 个附件 / {stats.associationCount} 条会话记录
        </div>
      )}
      <div style={s.row}>
        <button type="button" style={s.button} onClick={() => { void save() }}>保存</button>
        <button type="button" style={s.button} onClick={() => { void cleanupNow() }} disabled={cleaning}>
          {cleaning ? '清理中…' : '立即清理'}
        </button>
        {saved && <span style={s.badgeOk}>已保存 ✓</span>}
      </div>
      {cleanupMsg !== '' && <div style={s.badgeOk}>{cleanupMsg}</div>}
      {warn !== '' && <div style={s.badgeBad}>{warn}</div>}
      <div style={s.hint}>
        老化规则：超过「保留天数」未被读取/下载的附件字节会被清理（0 = 关闭该规则）。容量规则：超过上限时按最久未访问
        优先清理（0 = 不限制）。两级清理都只删字节、保留会话里的文件记录。
      </div>
    </div>
  )
}

/** 模块级 remote 引用（keyed 注册不支持 inject，由 index.tsx 注入）。 */
let retentionUpload: UploadRemote | null = null
let retentionUploadWaiters: ((u: UploadRemote | null) => void)[] = []

export function setRetentionUpload(u: UploadRemote): void {
  retentionUpload = u
  for (const waiter of retentionUploadWaiters) waiter(u)
  retentionUploadWaiters = []
}

function getRetentionUpload(): Promise<UploadRemote | null> {
  if (retentionUpload !== null) return Promise.resolve(retentionUpload)
  return new Promise(resolve => { retentionUploadWaiters.push(resolve) })
}

/** 设置 → 视觉辅助：配置 visual_assist 使用的视觉辅助模型（provider/model + 校验）。 */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { UploadRemote } from './remote.ts'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

interface Candidate {
  provider: string
  displayName: string
  models: { id: string; name: string; image: boolean }[]
}

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 16px', maxWidth: 480 } as CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: 8 } as CSSProperties,
  label: { width: 64, color: 'var(--dsw-alias-label-primary)', fontSize: 13 } as CSSProperties,
  select: {
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

export function VisionSettingsSection(_props: SettingsSectionOwnerProps): ReactElement {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [checked, setChecked] = useState<'none' | 'ok' | 'bad'>('none')
  const [checkText, setCheckText] = useState('')
  const [saved, setSaved] = useState(false)
  const [upload, setUpload] = useState<UploadRemote | null>(null)

  // 经注入面拿到 remote（keyed section 组件无注入，用模块级引用——见 index.tsx 的 setVisionUpload）。
  useEffect(() => {
    let disposed = false
    void (async () => {
      const u = await getVisionUpload()
      if (disposed || u === null) return
      setUpload(u)
      const cfg = await u.getVisionConfig()
      if (cfg.ok) {
        setProvider(cfg.value.config.provider ?? '')
        setModel(cfg.value.config.model ?? '')
      }
      const list = await u.listVisionCandidates()
      if (list.ok) setCandidates(list.value.providers)
    })()
    return () => { disposed = true }
  }, [])

  const currentModels = candidates.find(c => c.provider === provider)?.models ?? []

  const check = async (): Promise<void> => {
    if (upload === null || provider === '' || model === '') return
    const result = await upload.testVisionModel({ provider, model })
    if (result.ok) {
      setChecked(result.value.image ? 'ok' : 'bad')
      setCheckText(result.value.image ? '支持图片输入 ✓' : '纯文本模型，不能作为视觉辅助')
    } else {
      setChecked('bad')
      setCheckText(String(result.error ?? '校验失败'))
    }
  }

  const save = async (): Promise<void> => {
    if (upload === null) return
    await upload.setVisionConfig({ config: { provider: provider || undefined, model: model || undefined } })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={s.wrap}>
      <div style={s.hint}>
        visual_assist 工具使用的视觉辅助模型：当前对话模型无法看图时，把图片发给此模型并返回文字描述。
      </div>
      <div style={s.row}>
        <span style={s.label}>Provider</span>
        <select style={s.select} value={provider} onChange={e => { setProvider(e.target.value); setModel(''); setChecked('none') }}>
          <option value="">（未配置）</option>
          {candidates.map(c => (
            <option key={c.provider} value={c.provider}>{c.displayName}</option>
          ))}
        </select>
      </div>
      <div style={s.row}>
        <span style={s.label}>Model</span>
        <select style={s.select} value={model} onChange={e => { setModel(e.target.value); setChecked('none') }}>
          <option value="">（未选择）</option>
          {currentModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}{m.image ? '（支持图片）' : ''}
            </option>
          ))}
        </select>
      </div>
      <div style={s.row}>
        <button type="button" style={s.button} onClick={() => { void check() }}>校验</button>
        {checked === 'ok' && <span style={s.badgeOk}>{checkText}</span>}
        {checked === 'bad' && <span style={s.badgeBad}>{checkText}</span>}
        {checked === 'none' && model !== '' && <span style={s.badge}>未校验</span>}
      </div>
      <div style={s.row}>
        <button type="button" style={s.button} onClick={() => { void save() }}>保存</button>
        {saved && <span style={s.badgeOk}>已保存 ✓</span>}
      </div>
      <div style={s.hint}>
        提示：只有声明支持图片输入的模型能作为视觉辅助（校验通过为绿色）。未配置时 visual_assist 会报错并引导到本页。
      </div>
    </div>
  )
}

/** 模块级 remote 引用（keyed 注册不支持 inject，由 index.tsx 注入）。 */
let visionUpload: UploadRemote | null = null
let visionUploadWaiters: ((u: UploadRemote | null) => void)[] = []

export function setVisionUpload(u: UploadRemote): void {
  visionUpload = u
  for (const waiter of visionUploadWaiters) waiter(u)
  visionUploadWaiters = []
}

function getVisionUpload(): Promise<UploadRemote | null> {
  if (visionUpload !== null) return Promise.resolve(visionUpload)
  return new Promise(resolve => { visionUploadWaiters.push(resolve) })
}

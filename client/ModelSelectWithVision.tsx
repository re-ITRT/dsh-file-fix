/** 模型选择器（视觉置灰版）：接管 conversation.input.model seat。
 * - 通过模块级注入从 ctx.modelDirectories 获取 per-session ModelDirectory（因为
 *   shadow 注册拿不到官方 ui-model-selection 的 inject 面）。
 * - 当当前 session 需要视觉（直接图片注入）时，无视觉能力的模型 disabled 不可选。
 * - 视觉能力来自 listModelVisionSupport RPC（host 端 resolveModelInfo 判定模态）。
 * - UI 精简自官方 ModelSelect：触发按钮 + provider 分组列表，对齐 DSH 审美。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, CSSProperties, ReactElement } from 'react'
import type { ModelProviderGroup, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { UploadRemote } from './remote.ts'
import { fetchSessionNeedsVision, cachedSessionNeedsVision } from './vision-context.ts'

/** 样式（内联 + 主题变量，对齐 DSH MenuDropdown）。 */
const rootStyle: CSSProperties = { position: 'relative' }

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--dsw-alias-border-l4)',
  borderRadius: 8,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  cursor: 'pointer',
  maxWidth: 200,
}

const triggerLabel: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const visionBadge: CSSProperties = {
  flex: 'none',
  fontSize: 10,
  color: 'var(--dsw-alias-label-caption)',
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  bottom: 'calc(100% + 6px)',
  minWidth: 260,
  maxHeight: 320,
  overflowY: 'auto',
  padding: 6,
  borderRadius: 12,
  border: '1px solid var(--dsw-alias-border-l4)',
  background: 'var(--dsw-alias-bg-l2)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
  zIndex: 40,
}

const groupTitleStyle: CSSProperties = {
  padding: '6px 8px 4px',
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 11,
  fontWeight: 600,
}

const optionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
}

const optionDisabled: CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
}

const optionSelected: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

const optionVision: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: 'var(--dsw-alias-label-caption)',
}

type ModelItem = ModelProviderGroup['models'][number]

/** 模型视觉支持速查：provider/model → 是否支持图片输入。 */
export type ModelVisionMap = ReadonlyMap<string, boolean>

/** per-session ModelDirectory 的最小注入面（来自 ctx.modelDirectories）。 */
export interface ModelDirectoryLike {
  store: SnapshotStore<import('@deepseek-ai/dsh-client-ui-model-selection/client').ModelDirectoryState>
  load: () => void
  select: (selection: ModelSelection) => Promise<boolean>
}

/** 模块级注入面（slot 无自定义 inject，由 index.tsx 注入）。 */
interface ModelSelectService {
  directoryFor: (sessionId: string) => ModelDirectoryLike
  upload: UploadRemote
}
let modelService: ModelSelectService | null = null
let visionMapValue: ModelVisionMap = new Map()
let needsVisionValue: boolean | null = null

export function setModelSelectService(service: ModelSelectService): void {
  modelService = service
}

export function setModelVisionSupport(upload: UploadRemote, map: ModelVisionMap, needsVision: boolean | null): void {
  visionMapValue = map
  needsVisionValue = needsVision
}

/** 仅更新视觉需求（调试 / 视觉注入发生时调用）。 */
export function setModelNeedsVision(needsVision: boolean | null): void {
  needsVisionValue = needsVision
}

function getModelService(): ModelSelectService | null {
  return modelService
}

function getModelVisionMap(): ModelVisionMap {
  return visionMapValue
}

function getModelNeedsVision(): boolean | null {
  return needsVisionValue
}

export interface ModelSelectWithVisionProps {
  locked: boolean
  /** 当前会话 id（session 标准 kit 提供）。 */
  sessionId: string
}

export function ModelSelectWithVision(props: ModelSelectWithVisionProps): ReactElement | null {
  const { locked, sessionId } = props
  const service = getModelService()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // 每个 session 一个 directory（模块级 service 提供）。
  const directory = service?.directoryFor(sessionId)
  const state = useSyncExternalStore(
    fn => directory?.store.subscribe(fn) ?? (() => {}),
    () => directory?.store.getSnapshot() ?? { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null },
  )
  const upload = service?.upload ?? (null as unknown as UploadRemote)

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (directory !== undefined) directory.load()
  }, [directory])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // 视觉需求：拉取一次。
  useEffect(() => {
    if (getModelNeedsVision() !== null) return
    void fetchSessionNeedsVision(upload, sessionId)
  }, [upload, sessionId])

  const needsVisionResolved = getModelNeedsVision() ?? cachedSessionNeedsVision(sessionId) ?? false

  const currentChoice = state.groups
    .flatMap((group: ModelProviderGroup) => group.models.map((model: ModelItem) => ({ group, model })))
    .find(c => state.current?.provider === c.group.id && state.current.model === c.model.id)
  const modelLabel = currentChoice?.model.name ?? state.current?.model ?? '选择模型'

  const choose = (selection: ModelSelection): void => {
    setOpen(false)
    if (state.current?.provider === selection.provider && state.current.model === selection.model) return
    if (directory !== undefined) void directory.select(selection)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      queueMicrotask(() => { triggerRef.current?.focus() })
    }
  }

  const modelVision = (group: string, model: string): boolean => getModelVisionMap().get(group + '/' + model) ?? false

  return (
    <div ref={rootRef} style={rootStyle} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        style={triggerStyle}
        aria-label={'选择模型，当前 ' + modelLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={modelLabel}
        disabled={locked}
        onClick={() => setOpen(!open)}
      >
        <span style={triggerLabel}>{modelLabel}</span>
        {needsVisionResolved && <span style={visionBadge}>{'👁'}</span>}
        <span style={visionBadge}>{'▾'}</span>
      </button>

      {open && (
        <div style={menuStyle} role="menu" aria-label="选择模型">
          {state.status === 'loading' && <div style={groupTitleStyle}>加载中…</div>}
          {state.failures.map(failure => (
            <div key={failure.id} style={groupTitleStyle}>{failure.name}: 加载失败</div>
          ))}
          {state.groups.map((group: ModelProviderGroup) => (
            <div key={group.id} role="group">
              <div style={groupTitleStyle}>{group.name}</div>
              {group.models.map((model: ModelItem) => {
                const selected = state.current?.provider === group.id && state.current.model === model.id
                const vision = modelVision(group.id, model.id)
                const disabledByVision = needsVisionResolved && !vision
                const style = {
                  ...optionStyle,
                  ...(selected ? optionSelected : {}),
                  ...(disabledByVision ? optionDisabled : {}),
                }
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    style={style}
                    title={disabledByVision ? '此模型不支持图片输入，当前会话需要视觉' : model.name}
                    disabled={disabledByVision || state.status === 'selecting'}
                    onClick={() => choose({ provider: group.id, model: model.id })}
                  >
                    <span>{model.name}</span>
                    <span style={optionVision}>{disabledByVision ? '不支持图片' : vision ? '支持图片' : ''}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
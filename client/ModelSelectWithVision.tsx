/**
 * 模型选择器（完整复制官方 ModelSelect + 视觉置灰）。
 * - UI/交互/两级菜单/推理等级/Toast/键盘导航：与官方 @deepseek-ai/dsh-client-ui-model-selection
 *   的 ModelSelect 完全一致（复制官方实现，CSS 注入保持外观一致）。
 * - 唯一差异：模型选项的 disabled 增加视觉置灰——当当前 session 需要视觉
 *   （直接图片注入）时，不支持图片输入的模型置灰不可选。
 * - 数据来自模块级注入的 ctx.modelDirectories（shadow 注册拿不到官方 inject 面）。
 */

import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import type { ReactElement } from 'react'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'

type ModelItem = ModelProviderGroup['models'][number]
import type { UploadRemote } from './remote.ts'
import { fetchSessionNeedsVision, cachedSessionNeedsVision } from './vision-context.ts'
import { MODEL_SELECT_CSS } from './model-select.css.ts'

let cssInjected = false
function injectModelSelectCss(): void {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const el = document.createElement('style')
  el.dataset.filefixModelSelect = '1'
  el.textContent = MODEL_SELECT_CSS
  ;(document.head ?? document.documentElement).appendChild(el)
}

/** 简单 class 合并（替代 clsx，类名固定）。 */
function cx(...classes: Array<string | false | undefined | null>): string {
  return classes.filter(Boolean).join(' ')
}

/** 官方文案（zh）。 */
const T = {
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'empty.efforts': '当前模型未提供推理等级。',
} as const

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** per-session ModelDirectory 的最小注入面（来自 ctx.modelDirectories）。 */
export interface ModelDirectoryLike {
  store: SnapshotStore<import('@deepseek-ai/dsh-client-ui-model-selection/client').ModelDirectoryState>
  load: () => void
  select: (selection: ModelSelection) => Promise<boolean>
}

/** 模型视觉支持速查：provider/model → 是否支持图片输入。 */
export type ModelVisionMap = ReadonlyMap<string, boolean>

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

/** 仅更新视觉需求（视觉注入发生时调用）。 */
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

/** 查询：某个 provider/model 是否支持图片输入（TwoLayerRail 视觉裁剪用）。 */
export function modelSupportsVision(provider: string | undefined, model: string | undefined): boolean {
  if (provider === undefined || model === undefined) return true
  return visionMapValue.get(provider + '/' + model) ?? false
}

/** 查询：当前 session 是否标记为需要视觉。 */
export function sessionNeedsVision(): boolean | null {
  return needsVisionValue
}

/** 模块级：当前选中的 provider/model（ModelSelectWithVision 渲染时更新）。 */
let currentModelRef: { provider: string | undefined; model: string | undefined } = { provider: undefined, model: undefined }

/** 供 TwoLayerRail 等查询：当前模型是否支持图片输入（默认 true——未知时不做裁剪）。 */
export function currentModelSupportsVision(): boolean {
  const { provider, model } = currentModelRef
  if (provider === undefined || model === undefined) return true
  return visionMapValue.get(provider + '/' + model) ?? false
}

export interface ModelSelectWithVisionProps {
  locked: boolean
  /** 当前会话 id（session 标准 kit 提供）。 */
  sessionId: string
}

export function ModelSelectWithVision({ locked, sessionId }: ModelSelectWithVisionProps): ReactElement | null {
  injectModelSelectCss()
  const service = getModelService()
  const directory = service?.directoryFor(sessionId)
  const state = useSyncExternalStore(
    fn => directory?.store.subscribe(fn) ?? (() => {}),
    () => directory?.store.getSnapshot() ?? { current: null, routable: null, groups: [], failures: [], status: 'idle' as const, error: null },
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const upload = service?.upload ?? (null as unknown as UploadRemote)

  const choices = useMemo(() => state.groups.flatMap((group: ModelProviderGroup) =>
    group.models.map((model: ModelItem) => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? T['effort.providerDefault']
      : reasoning.efforts.find((level: ModelReasoningEffort) => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: T['effort.providerDefault'] }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: 'effort:' + effort.id,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning])
  const busy = state.status === 'selecting'

  // 视觉需求：拉取一次。
  useEffect(() => {
    if (getModelNeedsVision() !== null || upload === null) return
    void fetchSessionNeedsVision(upload, sessionId)
  }, [upload, sessionId])

  const reload = (): void => {
    lastActionRef.current = 'load'
    directory?.load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (directory !== undefined) {
      lastActionRef.current = 'load'
      directory.load()
    }
  }, [directory])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const show = (): void => {
    setPane('root')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory?.store.getSnapshot().error
    if (message !== null && message !== undefined) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: T['error.action'].replace('{message}', message) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    if (directory !== undefined) void directory.select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    if (directory !== undefined) void directory.select(selection).then(settleSelection)
  }

  // 更新模块级当前模型引用（视觉裁剪查询用）。
  currentModelRef = {
    provider: state.current?.provider,
    model: state.current?.model,
  }

  const modelLabel = currentChoice?.model.name ?? T['trigger.fallback']
  const triggerLabel = effortLabel === undefined ? modelLabel : modelLabel + ' · ' + effortLabel
  const triggerAria = currentChoice === undefined
    ? T['trigger.selectAria']
    : effortLabel === undefined
      ? T['trigger.aria'].replace('{model}', modelLabel)
      : T['trigger.ariaEffort'].replace('{model}', modelLabel).replace('{effort}', effortLabel)
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  // 视觉置灰：session 需要视觉且该模型不支持图片输入 → disabled。
  const needsVision = getModelNeedsVision() ?? cachedSessionNeedsVision(sessionId) ?? false
  const visionMap = getModelVisionMap()
  const visionDisabled = (group: string, model: string): boolean =>
    needsVision && !visionMap.get(group + '/' + model)

  return (
    <div ref={rootRef} className="filefix-ms-root" onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="filefix-ms-trigger"
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id + '-menu' : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else show()
        }}
      >
        <span className="filefix-ms-triggerLabel">{modelLabel}</span>
        {effortLabel !== undefined && <span className="filefix-ms-triggerEffort">{effortLabel}</span>}
        <svg className={cx('filefix-ms-chevron', open && 'filefix-ms-chevronOpen')} width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>

      {open && (
        <div
          id={id + '-menu'}
          className="filefix-ms-menu"
          role="menu"
          aria-label={T['menu.aria']}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className="filefix-ms-cell" onClick={() => { setPane('model') }}>
                <span className="filefix-ms-cellLabel">{T['menu.model']}</span>
                <span className="filefix-ms-cellValue">{modelLabel}</span>
                <svg className="filefix-ms-cellChevron" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 3L9.5 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className="filefix-ms-cell" onClick={() => { setPane('effort') }}>
                  <span className="filefix-ms-cellLabel">{T['menu.effort']}</span>
                  <span className="filefix-ms-cellValue">{effortLabel}</span>
                  <svg className="filefix-ms-cellChevron" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 3L9.5 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className="filefix-ms-status">{T['status.loading']}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className="filefix-ms-error">
                  <span>{T['error.action'].replace('{message}', state.error)}</span>
                  <button type="button" className="filefix-ms-retry" onClick={reload}>{T['action.reload']}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className="filefix-ms-warning" key={failure.id}>
                  <span>{T['warning.groupLoad'].replace('{name}', failure.name).replace('{message}', failure.message)}</span>
                  <button type="button" className="filefix-ms-retry" onClick={reload}>{T['action.reload']}</button>
                </div>
              ))}
              <div className="filefix-ms-groups">
                {state.groups.map((group: ModelProviderGroup) => {
                  const headingId = id + '-' + group.id
                  return (
                    <section role="group" aria-labelledby={headingId} className="filefix-ms-group" key={group.id}>
                      <div className="filefix-ms-groupTitle" id={headingId}>{group.name}</div>
                      {group.models.map((model: ModelItem) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        const visDisabled = visionDisabled(group.id, model.id)
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={cx('filefix-ms-option', selected && 'filefix-ms-selected')}
                            key={model.id}
                            title={visDisabled ? '此模型不支持图片输入，当前会话需要视觉' : model.name}
                            disabled={busy || visDisabled}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className="filefix-ms-optionCopy">
                              <span className="filefix-ms-modelName">{model.name}</span>
                              {model.description !== undefined && (
                                <span className="filefix-ms-description">{model.description}</span>
                              )}
                            </span>
                            <span className="filefix-ms-check">
                              {selected ? (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              ) : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className="filefix-ms-empty">{T['empty.models']}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className="filefix-ms-error">
                  <span>{T['error.action'].replace('{message}', state.error)}</span>
                  <button type="button" className="filefix-ms-retry" onClick={reload}>{T['action.reload']}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className="filefix-ms-empty">{T['empty.efforts']}</div>
                : effortChoices.map((level: EffortChoice) => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={cx('filefix-ms-option', effectiveEffort === level.effort && 'filefix-ms-selected')}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className="filefix-ms-optionCopy">
                      <span className="filefix-ms-modelName">{level.label}</span>
                      {level.description !== undefined && (
                        <span className="filefix-ms-description">{level.description}</span>
                      )}
                    </span>
                    <span className="filefix-ms-check">
                      {effectiveEffort === level.effort ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '10px 14px', borderRadius: 10, background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
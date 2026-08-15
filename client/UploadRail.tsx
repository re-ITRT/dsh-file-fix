/** 统一上传 rail：输入栏上方（hero 与 docked 两种态都渲染），图片与文件混排，三态 chip + 删除。 */

import { useEffect, useRef } from 'react'
import type { UploadLimits } from '../src/types.ts'
import { installFileIntercept } from './intercept.ts'
import type { UploadRemote } from './remote.ts'
import type { BakedUploadActions, UploadItem, UploadState } from './store.ts'
import { humanSize } from './thumbnail.ts'
import type { IntakeDeps, LoggerLike } from './upload-controller.ts'
import { intakeFiles, uploadOne } from './upload-controller.ts'
import * as s from './styles.ts'

/** provide 通道提供的输入面（运行时由 ui-conversation 提供，类型未入 slot 契约）。 */
interface DraftInput {
  draft: string
}

interface InputActionsLike {
  setDraft: (text: string) => void
}

export interface UploadRailProps {
  sessionId: string
  useStore: <S>(selector: (state: UploadState) => S) => S
  actions: BakedUploadActions
  /** provide 通道的输入钩子/动作：运行时必有，类型声明为可选以通过 slot 契约检查。 */
  useInput?: <S>(selector: (state: DraftInput) => S) => S
  inputActions?: InputActionsLike
  /** inject 面：upload 命名空间 + 限制读取 + 日志（apply 闭包内共享）。 */
  upload: UploadRemote
  getLimits: () => UploadLimits | null
  logger: LoggerLike
}

export function UploadRail(props: UploadRailProps): JSX.Element | null {
  const { sessionId, useStore, actions, useInput, inputActions, upload, getLimits, logger } = props
  const items = useStore(state => state.items)
  const notice = useStore(state => state.notice)
  const draft = useInput?.(state => state.draft) ?? ''

  // 事件发生时读最新快照：deps 用 ref 刷新，document 监听只装一次。
  const depsRef = useRef<IntakeDeps | null>(null)
  depsRef.current = {
    sessionId,
    remote: upload,
    actions,
    getLimits,
    getDraft: () => draft,
    setDraft: text => { inputActions?.setDraft(text) },
    logger,
  }

  useEffect(() => installFileIntercept({
    canAccept: () => true,
    onFiles: files => {
      const deps = depsRef.current
      if (deps !== null) void intakeFiles(deps, files, 'drop')
    },
  }), [])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => { actions.setNotice(null) }, 5000)
    return () => clearTimeout(timer)
  }, [notice, actions])

  const removeChip = (item: UploadItem): void => {
    actions.removeItem(item.id)
    logger.info('[dsh-upload-ux] chip removed %s -> remote %s', item.name, item.relPath ?? '(not uploaded)')
    if (item.relPath !== undefined) {
      void upload.removeFile({ sessionId, relPath: item.relPath }).then(result => {
        if (!result.ok) logger.warn('[dsh-upload-ux] remote remove failed %s: %o', item.relPath, result.error)
      })
    }
  }

  const retryChip = (item: UploadItem): void => {
    const deps = depsRef.current
    if (deps === null || item.data === '') return
    logger.info('[dsh-upload-ux] upload retry %s', item.name)
    actions.removeItem(item.id)
    actions.addUploading({ ...item, status: 'uploading', error: undefined })
    void uploadOne(deps, { ...item, status: 'uploading' }, 'retry')
  }

  if (items.length === 0 && notice === null) return null

  return (
    <div style={s.rail}>
      {items.map(item => (
        <div
          key={item.id}
          style={item.status === 'error' ? { ...s.chip, ...s.chipError } : s.chip}
          onClick={item.status === 'error' ? () => retryChip(item) : undefined}
          title={item.status === 'error' ? `${item.error ?? '上传失败'}（点击重试）` : item.name}
        >
          {item.thumbnail !== undefined && <img style={s.thumb} src={item.thumbnail} alt="" />}
          <span style={s.name}>{item.name}</span>
          <span style={s.meta}>
            {item.status === 'uploading' ? '上传中…' : item.status === 'done' ? humanSize(item.size) : item.error}
          </span>
          <button
            type="button"
            style={s.remove}
            aria-label={`移除 ${item.name}`}
            onClick={event => { event.stopPropagation(); removeChip(item) }}
          >
            ×
          </button>
        </div>
      ))}
      {notice !== null && <div style={s.notice}>{notice}</div>}
    </div>
  )
}

/** 统一上传 rail：输入栏上方，三态 chip + 删除；发送后自动清空（文件已随消息挂载）。 */

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

export interface UploadRailProps {
  sessionId: string
  useStore: <S>(selector: (state: UploadState) => S) => S
  actions: BakedUploadActions
  useInput?: <S>(selector: (state: DraftInput) => S) => S
  upload: UploadRemote
  getLimits: () => UploadLimits | null
  logger: LoggerLike
}

export function UploadRail(props: UploadRailProps): React.ReactElement | null {
  const { sessionId, useStore, actions, useInput, upload, getLimits, logger } = props
  const items = useStore(state => state.items)
  const notice = useStore(state => state.notice)
  const draft = useInput?.(state => state.draft) ?? ''
  const hadDraft = useRef(false)

  // 稳定 deps 引用（监听器只装一次，draft 变化不重建）。
  const depsRef = useRef<IntakeDeps | null>(null)
  depsRef.current = { sessionId, remote: upload, actions, getLimits, logger }

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__uploaduxRailMounted = true
    return installFileIntercept({
      canAccept: () => true,
      onFiles: files => { void intakeFiles(depsRef.current!, files, 'drop') },
    })
  }, [])

  // 发送即清空：草稿从非空变空 = 本次发送已提交，文件已随消息挂载。
  useEffect(() => {
    if (hadDraft.current && draft === '') {
      actions.clearAll()
      logger.info('[dsh-upload-ux] draft committed — rail cleared')
    }
    hadDraft.current = draft !== ''
  }, [draft])

  // notice 自动清。
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => actions.setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const removeChip = (item: UploadItem): void => {
    actions.removeItem(item.id)
    logger.info('[dsh-upload-ux] chip removed %s attachment=%s', item.name, item.attachmentId ?? '(pending)')
    if (item.attachmentId !== undefined) {
      void upload.unmarkPending({ sessionId, attachmentId: item.attachmentId }).catch(() => {})
      void upload.removeFile({ sessionId, attachmentId: item.attachmentId }).then(result => {
        if (!result.ok) logger.warn('[dsh-upload-ux] remote removeFile failed %s: %o', item.attachmentId, result.error)
      })
    }
  }

  const retryChip = (item: UploadItem): void => {
    const deps = depsRef.current
    if (deps === null || item.data === '') return
    logger.info('[dsh-upload-ux] upload retry %s', item.name)
    actions.removeItem(item.id)
    actions.addUploading({ ...item, status: 'uploading', error: undefined })
    void uploadOne(deps, { ...item, status: 'uploading' }, 'retry').then(file => {
      if (file !== undefined) {
        void deps.remote.markPending({ sessionId: deps.sessionId, files: [file] }).catch(() => {})
      }
    })
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

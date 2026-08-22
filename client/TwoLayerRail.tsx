/** 两层横向拖放 rail：图像层（官方 draft images）+ 文件层（插件附件）。
 * - 接管 conversation.input.attachments slot（priority 覆盖官方 ComposerAttachments）。
 * - 始终渲染两层放置区（即使无文件），让用户明确知道拖到哪。
 * - 图像层：图片拖到此处 → 走官方 createDraftImages 链路（直接注入模型上下文）。
 * - 文件层：任意文件拖到此处 → 走插件文件链路（字节入附件库 + 文本/文件注入）。
 * - 每层空态：虚线放置卡片 + 图标 + 说明；有内容时显示横向项目列表。
 * - 拖拽悬停：目标层高亮（边框变色 + 背景）。
 */

import { useState, useSyncExternalStore } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, ReactElement } from 'react'
import type {
  ComposerAttachmentsOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UploadLimits } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import type { UploadItem } from './store.ts'
import { humanSize } from './thumbnail.ts'
import type { LoggerLike } from './upload-controller.ts'
import { intakeFiles } from './upload-controller.ts'
import { getUploadStoreActions, getUploadStoreSnapshot, subscribeUploadStore } from './upload-store.ts'
import { markLocalSessionNeedsVision } from './vision-context.ts'
import * as s from './styles.ts'

/** 模块级注入面（slot 无自定义 inject，由 index.tsx 注入）。 */
interface TwoLayerShare {
  upload: UploadRemote
  getLimits: () => UploadLimits | null
  logger: LoggerLike
}
let twoLayerShare: TwoLayerShare | null = null

export function setTwoLayerShare(share: TwoLayerShare): void {
  twoLayerShare = share
}

export function getTwoLayerShare(): TwoLayerShare | null {
  return twoLayerShare
}

/** 在组件内读取模块级 share（slot 组件只收到官方 owner + 标准 kit）。 */
export function useTwoLayerShare(): TwoLayerShare | null {
  return twoLayerShare
}

/** 文件扩展名角标文案（≤4 字符；无扩展名用 F）。 */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return 'F'
  return name.slice(dot + 1).slice(0, 4)
}

/** 每层放置区的样式。 */
const layerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
}

/** 层标题行。 */
const layerHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
  lineHeight: 1,
  userSelect: 'none',
  padding: '0 2px',
}

const layerTitle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
}

const layerHint: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 11,
  marginLeft: 'auto',
}

/** 放置区容器：有内容时横向滚动列表；空时虚线卡片。 */
const dropZone: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 72,
  padding: '8px 10px',
  borderRadius: 12,
  border: '1.5px dashed var(--dsw-alias-border-l4)',
  background: 'color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 40%, transparent)',
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
  transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
}

const dropZoneFilled: CSSProperties = {
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l4)',
}

/** 拖拽悬停高亮。 */
const dropZoneActive: CSSProperties = {
  borderColor: 'var(--dsw-alias-interactive-bg-hover)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  boxShadow: '0 0 0 1px var(--dsw-alias-border-l3) inset',
}

/** 空态占位提示。 */
const dropPlaceholder: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
  margin: '0 auto',
  padding: '6px 0',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

const dropIcon: CSSProperties = {
  fontSize: 18,
  opacity: 0.7,
  flex: 'none',
}

const imageItem: CSSProperties = {
  position: 'relative',
  flex: '0 0 64px',
  width: 64,
  height: 64,
}

const imageThumb: CSSProperties = {
  width: 64,
  height: 64,
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, var(--dsw-alias-border-l4))',
  borderRadius: 16,
  background: 'var(--dsw-alias-interactive-bg-hover)',
}

const imageThumbImg: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
}

const imageRemove: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  zIndex: 1,
  display: 'grid',
  placeItems: 'center',
  width: 18,
  height: 18,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: 'var(--dsw-alias-button-contrast-fill)',
  color: 'var(--dsw-alias-label-primary-inverted)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
}

export interface TwoLayerRailProps extends ComposerAttachmentsOwnerProps {
  /** 框架注入的当前会话 id（session-maybe 标准 kit；无会话时为 undefined）。 */
  sessionId?: string | undefined
}

export function TwoLayerRail(props: TwoLayerRailProps): ReactElement {
  const {
    attachments, canAcceptDrop, onAddImages, onRemoveImage,
    sessionId,
  } = props
  const [imageDrop, setImageDrop] = useState(false)
  const [fileDrop, setFileDrop] = useState(false)
  const share = useTwoLayerShare()
  const upload = share?.upload
  const actions = getUploadStoreActions()
  const logger = share?.logger
  const getLimits = share?.getLimits

  // 插件文件层：模块级 store（useSyncExternalStore 读 snapshot）。
  const storeState = useSyncExternalStore(
    fn => subscribeUploadStore(fn),
    () => getUploadStoreSnapshot(),
  )
  const items: readonly UploadItem[] = storeState.items

  const hasImage = attachments.length > 0
  const hasFile = items.length > 0

  // 拖放：目标层 drop 处理。
  const dropToImages = (files: readonly File[]): void => {
    if (!canAcceptDrop) return
    onAddImages(files)
    if (sessionId !== undefined) markLocalSessionNeedsVision(sessionId)
  }
  const dropToFiles = (files: readonly File[]): void => {
    if (sessionId === undefined || upload === undefined || actions === undefined || logger === undefined) return
    void intakeFiles({ sessionId, remote: upload, actions, getLimits: getLimits ?? (() => null), logger }, files, 'layer-file')
  }

  // 每个层的 drag handlers（阻止默认 + 高亮）。
  const layerHandlers = (kind: 'image' | 'file') => {
    const setActive = kind === 'image' ? setImageDrop : setFileDrop
    return {
      onDragEnter: (e: ReactDragEvent) => { if (hasFiles(e)) { e.preventDefault(); setActive(true) } },
      onDragOver: (e: ReactDragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } },
      onDragLeave: (e: ReactDragEvent) => {
        // 只有离开当前层才取消高亮（避免子元素抖动）。
        if (hasFiles(e) && e.currentTarget === e.target) setActive(false)
      },
      onDrop: (e: ReactDragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setActive(false)
        const files = Array.from(e.dataTransfer.files ?? [])
        if (kind === 'image') dropToImages(files)
        else dropToFiles(files)
      },
    }
  }

  const removeFile = (item: UploadItem): void => {
    if (actions === undefined) return
    actions.removeItem(item.id)
    logger?.info('[dsh-file-fix] chip removed %s attachment=%s', item.name, item.attachmentId ?? '(pending)')
    if (item.attachmentId !== undefined && upload !== undefined && sessionId !== undefined) {
      void upload.unmarkPending({ sessionId, attachmentId: item.attachmentId }).catch(() => {})
      void upload.removeFile({ sessionId, attachmentId: item.attachmentId }).then(result => {
        if (!result.ok) logger?.warn('[dsh-file-fix] remote removeFile failed %s: %o', item.attachmentId, result.error)
      })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} data-filefix-two-layer>
      {/* 图像层：始终渲染放置区 */}
      <div style={layerStyle} data-filefix-layer="image">
        <div style={layerHeader}>
          <span style={dropIcon}>{'🖼'}</span>
          <span style={layerTitle}>图像层</span>
          <span style={layerHint}>图片 → 直接注入模型</span>
        </div>
        <div
          style={{
            ...dropZone,
            ...(hasImage ? dropZoneFilled : {}),
            ...(imageDrop ? dropZoneActive : {}),
          }}
          data-filefix-image-drop
          {...layerHandlers('image')}
        >
          {attachments.length === 0 && (
            <div style={dropPlaceholder}>
              <span style={dropIcon}>{'🖼'}</span>
              <span>{'拖图片到这里，直接加入模型上下文'}</span>
            </div>
          )}
          {attachments.map(attachment => (
            <div key={attachment.id} style={imageItem}>
              <div style={imageThumb}>
                <img style={imageThumbImg} src={attachment.previewUrl} alt={attachment.file.name} />
              </div>
              <button
                type="button"
                style={imageRemove}
                aria-label={'移除 ' + attachment.file.name}
                onClick={() => onRemoveImage(attachment.id)}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* 文件层：始终渲染放置区 */}
      <div style={layerStyle} data-filefix-layer="file">
        <div style={layerHeader}>
          <span style={dropIcon}>{'📎'}</span>
          <span style={layerTitle}>文件层</span>
          <span style={layerHint}>任意文件 → 以文件/文字注入</span>
        </div>
        <div
          style={{
            ...dropZone,
            ...(hasFile ? dropZoneFilled : {}),
            ...(fileDrop ? dropZoneActive : {}),
          }}
          data-filefix-file-drop
          {...layerHandlers('file')}
        >
          {items.length === 0 && (
            <div style={dropPlaceholder}>
              <span style={dropIcon}>{'📄'}</span>
              <span>{'拖文件到这里，以附件形式注入'}</span>
            </div>
          )}
          {items.map(item => (
            <div key={item.id} style={s.chip} title={item.name}>
              {item.thumbnail !== undefined
                ? <img style={s.thumb} src={item.thumbnail} alt="" />
                : <span style={s.extBadge}>{extOf(item.name)}</span>}
              <span style={s.name}>{item.name}</span>
              <span style={s.meta}>
                {item.status === 'uploading' ? '上传中…' : item.status === 'done' ? humanSize(item.size) : item.error}
              </span>
              <button type="button" style={s.remove} aria-label={'移除 ' + item.name} onClick={e => { e.stopPropagation(); removeFile(item) }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function hasFiles(e: ReactDragEvent): boolean {
  return e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files')
}

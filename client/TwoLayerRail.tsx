/** 两层横向拖放 rail：图像层（官方 draft images）+ 文件层（插件附件）。
 * - 接管 conversation.input.attachments slot（priority 覆盖官方 ComposerAttachments）。
 * - 图像层：官方 owner 提供的 draft images（attachments / onAddImages / onRemoveImage），
 *   图片拖到图像层 → 走官方 createDraftImages 链路（直接注入模型上下文）。
 * - 文件层：插件 UploadStore 的文件（persistFile + markPending），拖到文件层 →
 *   按插件文件逻辑以文本/文件形式注入。
 * - 空白区域 drop：按文件类型分流（图片 → 图像层，其他 → 文件层）。
 * - 视觉对齐 DSH：图像卡片 64px 圆角（官方 AttachmentRail 几何），文件层沿用现有 chip。
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

/** 样式（内联 style + 主题变量，与官方 AttachmentRail 几何对齐）。 */
const layerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
}

const layerLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 11,
  lineHeight: 1,
  userSelect: 'none',
}

const layerScroll: CSSProperties = {
  display: 'flex',
  gap: 10,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
  paddingBottom: 2,
  minHeight: 30,
  alignItems: 'center',
  borderRadius: 8,
  transition: 'background 0.15s ease, box-shadow 0.15s ease',
}

/** 拖放悬停高亮（用于目标层）。 */
const layerDropActive: CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
  boxShadow: '0 0 0 1px var(--dsw-alias-border-l4) inset',
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

/** 空白区 drop 分流：图片 → 图像层，其他 → 文件层。 */
function splitByType(files: readonly File[]): { images: File[]; others: File[] } {
  const images: File[] = []
  const others: File[] = []
  for (const file of files) {
    if (file.type.startsWith('image/')) images.push(file)
    else others.push(file)
  }
  return { images, others }
}

export function TwoLayerRail(props: TwoLayerRailProps): ReactElement | null {
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
  if (!hasImage && !hasFile) return null

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
      onDragLeave: () => { setActive(false) },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {hasImage && (
        <div style={layerStyle} data-filefix-layer="image">
          <div style={layerLabel}>{'🖼'} 图像层（直接注入模型）</div>
          <div
            style={{ ...layerScroll, ...(imageDrop ? layerDropActive : {}) }}
            data-filefix-image-drop
            {...layerHandlers('image')}
          >
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
      )}
      {hasFile && (
        <div style={layerStyle} data-filefix-layer="file">
          <div style={layerLabel}>{'📎'} 文件层（以文件/文字注入）</div>
          <div
            style={{ ...layerScroll, ...(fileDrop ? layerDropActive : {}) }}
            data-filefix-file-drop
            {...layerHandlers('file')}
          >
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
      )}
    </div>
  )
}

function hasFiles(e: ReactDragEvent): boolean {
  return e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files')
}
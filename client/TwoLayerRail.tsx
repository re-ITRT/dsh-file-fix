/** 两层拖放 rail：图像层（官方 draft images）+ 文件层（插件附件）。
 * - 接管 conversation.input.attachments slot（priority 覆盖官方 ComposerAttachments）。
 * - 渲染时机：
 *   - 有文件拖进 dsh 页面（dragenter）→ 渲染两层
 *   - 粘贴文件（paste）→ 渲染两层 + 自动分流（图片→图像层、文件→文件层）
 *   - 文件层有内容 → 渲染文件层；图像层有内容 → 渲染图像层
 *   - 其余情况 → 不渲染
 * - 拖拽分流：拖到文件层 → 全部进文件层；拖到图像层 → 图片进图像层、文件进文件层。
 * - 两层图片可相互拖动调整。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, ReactElement } from 'react'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'
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
import { getPageDrag, subscribePageDrag, setControllerAddImages, setControllerSessionId } from './two-layer-controller.ts'
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

/** 样式（内联 + 主题变量，与官方 AttachmentRail 几何对齐）。 */
const layerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
}

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

const dropZoneActive: CSSProperties = {
  borderColor: 'var(--dsw-alias-interactive-bg-hover)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  boxShadow: '0 0 0 1px var(--dsw-alias-border-l3) inset',
}

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
  cursor: 'grab',
}

const imageItemDragging: CSSProperties = {
  opacity: 0.5,
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

/** 判断是否含文件。 */
function hasFiles(e: ReactDragEvent): boolean {
  return e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files')
}

export function TwoLayerRail(props: TwoLayerRailProps): ReactElement | null {
  const {
    attachments, canAcceptDrop, onAddImages, onRemoveImage,
    sessionId,
  } = props

  // 把官方 owner 的图片注入能力 + 会话 id 同步给 controller（paste 分流用）。
  setControllerAddImages(files => { onAddImages(files) }, () => canAcceptDrop)
  setControllerSessionId(sessionId)
  const [imageDrop, setImageDrop] = useState(false)
  const [fileDrop, setFileDrop] = useState(false)
  const share = useTwoLayerShare()
  const upload = share?.upload
  const actions = getUploadStoreActions()
  const logger = share?.logger
  const getLimits = share?.getLimits

  // 插件文件层：模块级 store。
  const storeState = useSyncExternalStore(
    fn => subscribeUploadStore(fn),
    () => getUploadStoreSnapshot(),
  )
  const items: readonly UploadItem[] = storeState.items

  // 页面拖拽/粘贴激活状态（由 controller 管理）。
  const [pageDrag, setPageDragLocal] = useState(getPageDrag())
  useEffect(() => {
    const sync = (): void => setPageDragLocal(getPageDrag())
    sync()
    return subscribePageDrag(sync)
  }, [])

  // 渲染时机：页面拖拽进入 / 粘贴 / 文件层有内容 / 图像层有内容。
  const hasImage = attachments.length > 0
  const hasFile = items.length > 0
  const showImageLayer = pageDrag || hasImage
  const showFileLayer = pageDrag || hasFile
  if (!showImageLayer && !showFileLayer) return null

  // 拖放：目标层 drop 处理。
  const dropToFiles = (files: readonly File[]): void => {
    if (sessionId === undefined || upload === undefined || actions === undefined || logger === undefined) return
    void intakeFiles({ sessionId, remote: upload, actions, getLimits: getLimits ?? (() => null), logger }, files, 'layer-file')
  }
  // 图像层 drop：图片进官方、其他进文件层。
  const dropToImageLayer = (files: readonly File[]): void => {
    const images = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (images.length > 0 && canAcceptDrop) {
      onAddImages(images)
      if (sessionId !== undefined) markLocalSessionNeedsVision(sessionId)
    }
    if (others.length > 0) dropToFiles(others)
  }

  // 两层图片互拖。
  const [dragKind, setDragKind] = useState<'image' | 'file' | null>(null)

  const itemToFile = (item: UploadItem): File => {
    const bytes = atob(item.data)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
    return new File([arr], item.name, { type: item.mediaType || 'application/octet-stream' })
  }

  const onFileItemDragStart = (e: ReactDragEvent, item: UploadItem): void => {
    if (item.data === '' || !item.mediaType.startsWith('image/')) return
    e.dataTransfer.setData('application/x-filefix-item', item.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragKind('file')
  }
  const onImageItemDragStart = (e: ReactDragEvent): void => {
    e.dataTransfer.setData('application/x-filefix-image', '1')
    e.dataTransfer.effectAllowed = 'move'
    setDragKind('image')
  }
  const onImageLayerDropFromFile = (e: ReactDragEvent): void => {
    const itemId = e.dataTransfer.getData('application/x-filefix-item')
    if (itemId !== '') {
      e.preventDefault()
      const item = items.find(i => i.id === itemId)
      if (item !== undefined && item.data !== '' && canAcceptDrop) {
        onAddImages([itemToFile(item)])
        actions.removeItem(item.id)
        if (sessionId !== undefined) markLocalSessionNeedsVision(sessionId)
        setDragKind(null)
      }
    }
  }
  const removeFile = (item: UploadItem): void => {
    if (actions === undefined) return
    removeFileOf(actions, item, upload, sessionId, logger)
  }
  const onFileLayerDropFromImage = (e: ReactDragEvent, imageId: string): void => {
    e.preventDefault()
    const attachment = attachments.find(a => a.id === imageId)
    if (attachment !== undefined && sessionId !== undefined && upload !== undefined && actions !== undefined && logger !== undefined) {
      onRemoveImage(attachment.id)
      void intakeFiles({ sessionId, remote: upload, actions, getLimits: getLimits ?? (() => null), logger }, [attachment.file], 'layer-reorder')
    }
    setDragKind(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} data-filefix-two-layer>
      {/* 图像层 */}
      {showImageLayer && (
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
            onDragOver={e => {
              if (hasFiles(e) || e.dataTransfer.getData('application/x-filefix-item') !== '') {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setImageDrop(true)
              }
            }}
            onDragLeave={() => setImageDrop(false)}
            onDrop={e => {
              const itemId = e.dataTransfer.getData('application/x-filefix-item')
              if (itemId !== '') { onImageLayerDropFromFile(e); return }
              if (!hasFiles(e)) return
              e.preventDefault()
              setImageDrop(false)
              dropToImageLayer(Array.from(e.dataTransfer.files ?? []))
            }}
          >
            {attachments.length === 0 && (
              <div style={dropPlaceholder}>
                <span style={dropIcon}>{'🖼'}</span>
                <span>{'拖图片到这里，直接加入模型上下文'}</span>
              </div>
            )}
            {attachments.map(attachment => (
              <div
                key={attachment.id}
                style={{ ...imageItem, ...(dragKind === 'image' ? imageItemDragging : {}) }}
                draggable
                onDragStart={onImageItemDragStart}
              >
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

      {/* 文件层 */}
      {showFileLayer && (
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
            onDragOver={e => {
              if (hasFiles(e) || e.dataTransfer.getData('application/x-filefix-image') !== '') {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setFileDrop(true)
              }
            }}
            onDragLeave={() => setFileDrop(false)}
            onDrop={e => {
              const imageFlag = e.dataTransfer.getData('application/x-filefix-image')
              if (imageFlag !== '') {
                setFileDrop(false)
                return
              }
              if (!hasFiles(e)) return
              e.preventDefault()
              setFileDrop(false)
              dropToFiles(Array.from(e.dataTransfer.files ?? []))
            }}
          >
            {items.length === 0 && (
              <div style={dropPlaceholder}>
                <span style={dropIcon}>{'📄'}</span>
                <span>{'拖文件到这里，以附件形式注入'}</span>
              </div>
            )}
            {items.map(item => (
              <div
                key={item.id}
                style={{ ...s.chip, ...(dragKind === 'file' ? imageItemDragging : {}) }}
                title={item.name}
                draggable={item.mediaType.startsWith('image/') && item.data !== ''}
                onDragStart={e => onFileItemDragStart(e, item)}
                onDragOver={e => {
                  if (e.dataTransfer.getData('application/x-filefix-image') !== '' && item.mediaType.startsWith('image/')) {
                    e.preventDefault()
                    setFileDrop(true)
                  }
                }}
                onDrop={e => {
                  const imageFlag = e.dataTransfer.getData('application/x-filefix-image')
                  if (imageFlag !== '') {
                    const att = attachments[0]
                    if (att !== undefined) onFileLayerDropFromImage(e, att.id)
                    return
                  }
                }}
              >
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

function removeFileOf(actions: ReturnType<typeof getUploadStoreActions>, item: UploadItem, upload: UploadRemote | undefined, sessionId: string | undefined, logger: LoggerLike | undefined): void {
  actions.removeItem(item.id)
  logger?.info('[dsh-file-fix] chip removed %s attachment=%s', item.name, item.attachmentId ?? '(pending)')
  if (item.attachmentId !== undefined && upload !== undefined && sessionId !== undefined) {
    void upload.unmarkPending({ sessionId, attachmentId: item.attachmentId }).catch(() => {})
    void upload.removeFile({ sessionId, attachmentId: item.attachmentId }).then(result => {
      if (!result.ok) logger?.warn('[dsh-file-fix] remote removeFile failed %s: %o', item.attachmentId, result.error)
    })
  }
}
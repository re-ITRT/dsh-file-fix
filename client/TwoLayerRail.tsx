/** 两层横向拖放 rail：图像层（官方 draft images）+ 文件层（插件附件）。
 * - 注册在 conversation.input.dock（composer 内始终渲染）。
 * - 图像层：图片 → 官方注入（onAddImages 来自 AttachmentsBridge，注册在 attachments slot）。
 * - 文件层：插件文件（persistFile + markPending）。
 * - 渲染时机：拖拽/粘贴进页面（controller）或层有内容时显示对应层。
 * - 拖拽分流：拖到文件层 → 全部进文件层；拖到图像层 → 图片进图像层、文件进文件层。
 * - 两层图片可相互拖动调整。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, ReactElement } from 'react'
import type { UploadLimits, UploadedFile } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import type { UploadItem } from './store.ts'
import { humanSize } from './thumbnail.ts'
import type { LoggerLike } from './upload-controller.ts'
import { intakeFiles } from './upload-controller.ts'
import { markLocalSessionNeedsVision, clearLocalSessionNeedsVision, fetchSessionNeedsVision } from './vision-context.ts'
import { currentModelSupportsVision } from './ModelSelectWithVision.tsx'
import { setTwoLayerHandle, setBridgeSessionId, getPageDrag, subscribePageDrag } from './two-layer-bridge.ts'
import { getAttachmentBridge, subscribeAttachmentBridge } from './attachment-bridge.tsx'
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

/** 文件扩展名角标文案（≤4 字符；无扩展名用 F）。 */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return 'F'
  return name.slice(dot + 1).slice(0, 4)
}

/** 样式（内联 + 主题变量）。 */
const layerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const layerHeader: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-label-caption)', fontSize: 12, lineHeight: 1, userSelect: 'none', padding: '0 2px' }
const layerTitle: CSSProperties = { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 12 }
const layerHint: CSSProperties = { color: 'var(--dsw-alias-label-caption)', fontSize: 11, marginLeft: 'auto' }
const dropZone: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 72, padding: '8px 10px', borderRadius: 12, border: '1.5px dashed var(--dsw-alias-border-l4)', background: 'color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 40%, transparent)', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease' }
const dropZoneFilled: CSSProperties = { borderStyle: 'solid', borderColor: 'var(--dsw-alias-border-l4)' }
const dropZoneActive: CSSProperties = { borderColor: 'var(--dsw-alias-interactive-bg-hover)', background: 'var(--dsw-alias-interactive-bg-hover)', boxShadow: '0 0 0 1px var(--dsw-alias-border-l3) inset' }
const dropPlaceholder: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-caption)', fontSize: 12, margin: '0 auto', padding: '6px 0', userSelect: 'none', whiteSpace: 'nowrap' }
const dropIcon: CSSProperties = { fontSize: 18, opacity: 0.7, flex: 'none' }
const imageItem: CSSProperties = { position: 'relative', flex: '0 0 64px', width: 64, height: 64, cursor: 'grab' }
const imageItemDragging: CSSProperties = { opacity: 0.5 }
const imageThumb: CSSProperties = { width: 64, height: 64, overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, var(--dsw-alias-border-l4))', borderRadius: 16, background: 'var(--dsw-alias-interactive-bg-hover)' }
const imageThumbImg: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'cover' }
const imageRemove: CSSProperties = { position: 'absolute', top: 4, right: 4, zIndex: 1, display: 'grid', placeItems: 'center', width: 18, height: 18, padding: 0, border: 'none', borderRadius: '50%', background: 'var(--dsw-alias-button-contrast-fill)', color: 'var(--dsw-alias-label-primary-inverted)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }

export interface TwoLayerRailProps {
  /** 当前会话 id（session 标准 kit 提供）。 */
  sessionId: string
  /** 当前会话的 SessionInput（含 pruneImages，用于无视觉模型时裁剪图像层）。 */
  sessionInput?: {
    state: { subscribe: (fn: () => void) => () => void; getSnapshot: () => { imageIds: readonly string[] } }
    pruneImages: (ids: readonly string[]) => void
  } | unknown
}

/** 是否拖拽（不检查 types：从外部窗口拖文件时 types 可能为空，但 dataTransfer 存在即可 drop）。 */
function hasFiles(e: ReactDragEvent): boolean {
  return e.dataTransfer !== null
}

export function TwoLayerRail({ sessionId, sessionInput }: TwoLayerRailProps): ReactElement | null {
  const [items, setItems] = useState<UploadItem[]>([])
  const [imageDrop, setImageDrop] = useState(false)
  const [fileDrop, setFileDrop] = useState(false)
  const [dragKind, setDragKind] = useState<'image' | 'file' | null>(null)
  const [pageDrag, setPageDragState] = useState(getPageDrag())
  const [bridge, setBridgeState] = useState(getAttachmentBridge())
  const share = twoLayerShare
  const upload = share?.upload
  const logger = share?.logger
  const getLimits = share?.getLimits
  const itemsRef = useRef(items)
  itemsRef.current = items

  // 同步 bridge + pageDrag。
  useEffect(() => {
    const sync = (): void => { setBridgeState(getAttachmentBridge()) }
    sync()
    return subscribeAttachmentBridge(sync)
  }, [])
  useEffect(() => {
    const sync = (): void => { setPageDragState(getPageDrag()) }
    sync()
    return subscribePageDrag(sync)
  }, [])
  useEffect(() => { setBridgeSessionId(sessionId) }, [sessionId])

  // 视觉裁剪 + 发送后清空：
  // - 当前模型不支持视觉 + 图像层有图片 → 自动清空图像层（发送时裁掉）。
  // - 发送完成后（phase submitting → plain）→ 清空文件层（文件已注入）。
  useEffect(() => {
    const input = sessionInput as {
      state: { subscribe: (fn: () => void) => () => void; getSnapshot: () => { imageIds: readonly string[]; phase: string } }
      pruneImages: (ids: readonly string[]) => void
    } | undefined
    if (input === undefined || typeof input !== 'object' || input === null) return
    let wasSubmitting = false
    return input.state.subscribe(() => {
      const snapshot = input.state.getSnapshot()
      const phase = snapshot.phase
      // 发送完成后清空文件层。
      if (wasSubmitting && phase === 'plain') {
        setItems([])
      }
      wasSubmitting = phase === 'submitting' || phase === 'claimed'
      // 视觉裁剪：无视觉模型 + 图像层有图片 → 裁掉。
      const ids = snapshot.imageIds
      if (ids.length > 0 && !currentModelSupportsVision()) {
        input.pruneImages([])
      }
    })
  }, [sessionInput])

  // 注册 handle（controller 调用）。
  useEffect(() => {
    setTwoLayerHandle({
      handleFiles: (files, via) => { intakeIntoLayer(files, via) },
      addImages: (files) => {
        if (bridge?.canAcceptDrop === true) {
          bridge.onAddImages(files)
          markLocalSessionNeedsVision(sessionId)
        }
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, sessionId])

  // 文件层处理：本地管理（不依赖跨模块 store，避免双实例）。
  const intakeIntoLayer = (files: readonly File[], via: string): void => {
    if (upload === undefined || logger === undefined) return
    // 每个文件本地加入（上传中状态），persistFile 后更新为 done。
    for (const file of files) {
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      const item: UploadItem = { id, name: file.name, size: file.size, mediaType: file.type, data: '', status: 'uploading' }
      setItems(prev => [...prev, item])
      void readAsDataUrlLocal(file).then(data => {
        if (data === '') {
          setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'error' as const, error: '读取失败' } : i))
          return
        }
        setItems(prev => prev.map(i => i.id === id ? { ...i, data } : i))
        void upload.persistFile({ sessionId, name: file.name, mediaType: file.type, data }).then(result => {
          if (!result.ok) {
            setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'error' as const, error: '上传失败' } : i))
            return
          }
          const outcome = result.value
          if (!outcome.ok) {
            setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'error' as const, error: outcome.code } : i))
            return
          }
          setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'done' as const, attachmentId: outcome.file.attachmentId, size: outcome.file.size } : i))
          void upload.markPending({ sessionId, files: [outcome.file] }).catch(() => {})
        })
      })
    }
  }

  function readAsDataUrlLocal(file: File): Promise<string> {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(file)
    })
  }

  const attachments = bridge?.attachments ?? []
  const hasImage = attachments.length > 0
  const hasFile = items.length > 0
  const showImageLayer = pageDrag || hasImage
  const showFileLayer = pageDrag || hasFile
  if (!showImageLayer && !showFileLayer) return null

  const dropToFiles = (files: readonly File[]): void => {
    intakeIntoLayer(files, 'layer-file')
  }
  const dropToImageLayer = (files: readonly File[]): void => {
    const images = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (images.length > 0 && bridge?.canAcceptDrop === true) {
      bridge.onAddImages(images)
      markLocalSessionNeedsVision(sessionId)
    }
    if (others.length > 0) dropToFiles(others)
  }

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
        if (files.length === 0) return
        if (kind === 'image') dropToImageLayer(files)
        else dropToFiles(files)
      },
    }
  }

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
  const onImageItemDragStart = (e: ReactDragEvent, attachmentId: string): void => {
    e.dataTransfer.setData('application/x-filefix-image', attachmentId)
    e.dataTransfer.effectAllowed = 'move'
    setDragKind('image')
  }
  const onImageLayerDropFromFile = (e: ReactDragEvent): void => {
    const itemId = e.dataTransfer.getData('application/x-filefix-item')
    if (itemId !== '') {
      e.preventDefault()
      const item = items.find(i => i.id === itemId)
      if (item !== undefined && item.data !== '' && bridge?.canAcceptDrop === true) {
        bridge.onAddImages([itemToFile(item)])
        setItems(prev => prev.filter(i => i.id !== itemId))
        markLocalSessionNeedsVision(sessionId)
        setDragKind(null)
      }
    }
  }
  const removeFile = (item: UploadItem): void => {
    setItems(prev => prev.filter(i => i.id !== item.id))
    // 已上传完成（有 attachmentId）的文件：撤销 pending 挂载，避免删除后仍注入。
    // Bug 2：删除列表项后，下次发送不应再注入该文件。
    if (item.status === 'done' && item.attachmentId !== undefined && upload !== undefined) {
      void upload.unmarkPending({ sessionId, attachmentId: item.attachmentId }).catch(() => {})
    }
    // 删除图片后重新判定视觉需求（Bug 3）。
    if (item.mediaType.startsWith('image/')) {
      reconcileVisionNeeds(sessionId, item)
    }
    logger?.info('[dsh-file-fix] chip removed %s', item.name)
  }

  /**
   * 删除图片后重判本 session 是否仍需要视觉（Bug 3）：
   * 视觉需求 = 图像层（官方 draft images）有图 OR 文件层还有未删除的图片。
   * 两层都空了 → 清除本地标记，并重新向 host 查询「已注入历史」的判定。
   * @param removedItem 正在从文件层删除的文件（排除它，因为 setItems 尚未生效）。
   * @param removedAttachmentId 正在从图像层删除的 attachmentId（排除它，因为 attachments 尚未更新）。
   */
  const reconcileVisionNeeds = (sid: string, removedItem?: UploadItem, removedAttachmentId?: string): void => {
    const imageLayerHas = attachments.some(a => String(a.id) !== removedAttachmentId)
    const fileLayerHas = items.some(i => i.mediaType.startsWith('image/') && i.id !== removedItem?.id)
    if (imageLayerHas || fileLayerHas) return
    // 当前列表已无图片：清本地缓存 + 重新查询 host（可能仍有历史注入）。
    clearLocalSessionNeedsVision(sid)
    if (upload !== undefined) void fetchSessionNeedsVision(upload, sid)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} data-filefix-two-layer>
      {showImageLayer && (
        <div style={layerStyle} data-filefix-layer="image">
          <div style={layerHeader}>
            <span style={dropIcon}>{'🖼'}</span>
            <span style={layerTitle}>图像层</span>
            <span style={layerHint}>图片 → 直接注入模型</span>
          </div>
          <div
            style={{ ...dropZone, ...(hasImage ? dropZoneFilled : {}), ...(imageDrop ? dropZoneActive : {}) }}
            data-filefix-image-drop
            onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setImageDrop(true) } }}
            onDragLeave={() => setImageDrop(false)}
            onDrop={e => {
              const itemId = e.dataTransfer.getData('application/x-filefix-item')
              if (itemId !== '') { onImageLayerDropFromFile(e); return }
              if (!hasFiles(e)) return
              e.preventDefault()
              setImageDrop(false)
              const files = Array.from(e.dataTransfer.files ?? [])
              if (files.length > 0) dropToImageLayer(files)
            }}
          >
            {attachments.length === 0 && (
              <div style={dropPlaceholder}><span style={dropIcon}>{'🖼'}</span><span>{'拖图片到这里，直接加入模型上下文'}</span></div>
            )}
            {attachments.map(attachment => (
              <div key={attachment.id} style={{ ...imageItem, ...(dragKind === 'image' ? imageItemDragging : {}) }} draggable onDragStart={e => onImageItemDragStart(e, String(attachment.id))}>
                <div style={imageThumb}><img style={imageThumbImg} src={attachment.previewUrl} alt={attachment.file.name} /></div>
                <button type="button" style={imageRemove} aria-label={'移除 ' + attachment.file.name} onClick={() => {
                  bridge?.onRemoveImage(attachment.id)
                  reconcileVisionNeeds(sessionId, undefined, String(attachment.id))
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showFileLayer && (
        <div style={layerStyle} data-filefix-layer="file">
          <div style={layerHeader}>
            <span style={dropIcon}>{'📎'}</span>
            <span style={layerTitle}>文件层</span>
            <span style={layerHint}>任意文件 → 以文件/文字注入</span>
          </div>
          <div
            style={{ ...dropZone, ...(hasFile ? dropZoneFilled : {}), ...(fileDrop ? dropZoneActive : {}) }}
            data-filefix-file-drop
            onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setFileDrop(true) } }}
            onDragLeave={() => setFileDrop(false)}
            onDrop={e => {
              // 图像层拖来的图片 → 进文件层（插件上传）+ 从图像层移除。
              const imageFlag = e.dataTransfer.getData('application/x-filefix-image')
              if (imageFlag !== '') {
                e.preventDefault()
                setFileDrop(false)
                const attachment = attachments.find(a => String(a.id) === imageFlag) ?? attachments[0]
                if (attachment !== undefined) {
                  intakeIntoLayer([attachment.file], 'layer-reorder')
                  bridge?.onRemoveImage(attachment.id)
                  setDragKind(null)
                }
                return
              }
              if (!hasFiles(e)) return
              e.preventDefault()
              setFileDrop(false)
              const files = Array.from(e.dataTransfer.files ?? [])
              if (files.length > 0) dropToFiles(files)
            }}
          >
            {items.length === 0 && (
              <div style={dropPlaceholder}><span style={dropIcon}>{'📄'}</span><span>{'拖文件到这里，以附件形式注入'}</span></div>
            )}
            {items.map(item => (
              <div key={item.id} style={s.chip} title={item.name} draggable={item.mediaType.startsWith('image/') && item.data !== ''} onDragStart={e => onFileItemDragStart(e, item)}>
                {item.thumbnail !== undefined ? <img style={s.thumb} src={item.thumbnail} alt="" /> : <span style={s.extBadge}>{extOf(item.name)}</span>}
                <span style={s.name}>{item.name}</span>
                <span style={s.meta}>{item.status === 'uploading' ? '上传中…' : item.status === 'done' ? humanSize(item.size) : item.error}</span>
                <button type="button" style={s.remove} aria-label={'移除 ' + item.name} onClick={e => { e.stopPropagation(); removeFile(item) }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
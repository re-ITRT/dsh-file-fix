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
import { markLocalSessionNeedsVision } from './vision-context.ts'
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
}

/** 是否拖拽（不检查 types：从外部窗口拖文件时 types 可能为空，但 dataTransfer 存在即可 drop）。 */
function hasFiles(e: ReactDragEvent): boolean {
  return e.dataTransfer !== null
}

export function TwoLayerRail({ sessionId }: TwoLayerRailProps): ReactElement | null {
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
    logger?.info('[dsh-file-fix] chip removed %s', item.name)
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
                <button type="button" style={imageRemove} aria-label={'移除 ' + attachment.file.name} onClick={() => bridge?.onRemoveImage(attachment.id)}>×</button>
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
/** 两层放置区控制器：document 级拖拽/粘贴拦截（插件 apply 时始终安装，独立于 slot 渲染）。
 * - paste：拦截官方 InputBar（preventDefault + stopPropagation），交给 TwoLayerRail 的 handle
 *   （图片→图像层 addImages、文件→文件层 handleFiles）。
 * - drop：capture 阶段 preventDefault（阻止官方/浏览器默认），由层内 React onDrop 处理。
 * - dragenter：显示两层（让用户选择拖到哪层）。
 */

import type { LoggerLike } from './upload-controller.ts'
import { getBridgeSessionId, getTwoLayerHandle } from './two-layer-bridge.ts'

/** 控制器依赖（模块级注入）。 */
interface ControllerShare {
  upload: import('./remote.ts').UploadRemote
  getLimits: () => import('../src/types.ts').UploadLimits | null
  logger: LoggerLike
  getSessionId: () => string | undefined
  onAddImages: (files: readonly File[]) => void
  canAcceptDrop: () => boolean
  markVision: (sessionId: string) => void
}
let controllerShare: ControllerShare | null = null
export function setTwoLayerController(share: ControllerShare): void {
  controllerShare = share
}

/** 页面级拖拽/粘贴激活状态（显示两层）。 */
let pageDrag = false
const pageDragListeners = new Set<() => void>()
function setPageDrag(value: boolean): void {
  if (pageDrag === value) return
  pageDrag = value
  for (const fn of [...pageDragListeners]) fn()
}
export function subscribePageDrag(fn: () => void): () => void {
  pageDragListeners.add(fn)
  return () => { pageDragListeners.delete(fn) }
}
export function getPageDrag(): boolean {
  return pageDrag
}

let installed = false
/** apply 时安装 document 级拦截（幂等）。 */
export function installTwoLayerController(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  const isFileDrag = (e: DragEvent): boolean =>
    e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files')

  let dragDepth = 0

  const onDragEnter = (e: DragEvent): void => {
    if (!isFileDrag(e)) return
    dragDepth += 1
    setPageDrag(true)
  }
  const onDragOver = (e: DragEvent): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: DragEvent): void => {
    if (!isFileDrag(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) setPageDrag(false)
  }
  const onDrop = (e: DragEvent): void => {
    // 拦截文件 drop（阻止官方/浏览器默认），层内 React onDrop 负责处理。
    if (isFileDrag(e)) e.preventDefault()
    dragDepth = 0
    setPageDrag(false)
  }

  // paste：拦截官方 InputBar，交给 TwoLayerRail handle 分流。
  const onPaste = (e: ClipboardEvent): void => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    // 显示两层（短暂），让用户看到文件进入哪层。
    setPageDrag(true)
    const handle = getTwoLayerHandle()
    if (handle !== null) {
      const images = files.filter(f => f.type.startsWith('image/'))
      const others = files.filter(f => !f.type.startsWith('image/'))
      if (images.length > 0) handle.addImages(images)
      if (others.length > 0) handle.handleFiles(others, 'layer-paste')
    }
    setTimeout(() => setPageDrag(false), 2000)
  }

  document.addEventListener('dragenter', onDragEnter, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)
  document.addEventListener('paste', onPaste, true)
}

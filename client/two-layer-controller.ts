/** 两层放置区控制器：document 级拖拽/粘贴拦截（插件 apply 时始终安装，独立于 slot 渲染）。
 * - 目的：无论 conversation.input.attachments 是否渲染，拖拽/粘贴文件都被本控制器拦截，
 *   先显示两层（图像层/文件层），再按目标处理。
 * - paste：拦截官方 InputBar（preventDefault + stopPropagation），自动分流（图片→图像层、文件→文件层）。
 * - drop：capture 阶段 preventDefault（阻止官方/浏览器默认），由层内 React onDrop 处理；
 *   空白 drop 忽略。
 */

import type { UploadRemote } from './remote.ts'
import type { BakedUploadActions, UploadItem, UploadState } from './store.ts'
import type { LoggerLike } from './upload-controller.ts'
import { intakeFiles } from './upload-controller.ts'
import { getUploadStoreActions, getUploadStoreSnapshot, subscribeUploadStore } from './upload-store.ts'

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

/** TwoLayerRail 运行时更新 onAddImages/canAcceptDrop（来自 attachments owner）。 */
export function setControllerAddImages(
  onAddImages: (files: readonly File[]) => void,
  canAcceptDrop: () => boolean,
): void {
  if (controllerShare === null) return
  controllerShare = { ...controllerShare, onAddImages, canAcceptDrop }
}

/** TwoLayerRail 运行时更新当前会话 id（paste 分流用）。 */
export function setControllerSessionId(sessionId: string | undefined): void {
  if (controllerShare === null) return
  controllerShare = { ...controllerShare, getSessionId: () => sessionId }
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

  // paste：拦截官方 InputBar，自动分流。
  const onPaste = (e: ClipboardEvent): void => {
    const share = controllerShare
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    // 显示两层（短暂），让用户看到文件进入哪层。
    setPageDrag(true)
    const sessionId = share?.getSessionId()
    if (sessionId === undefined) return
    const images = files.filter(f => f.type.startsWith('image/'))
    const others = files.filter(f => !f.type.startsWith('image/'))
    if (images.length > 0 && share?.canAcceptDrop() === true) {
      share.onAddImages(images)
      share.markVision(sessionId)
    }
    if (others.length > 0 && share !== null) {
      const actions = getUploadStoreActions()
      const store = getUploadStoreSnapshot()
      void intakeFiles(
        { sessionId, remote: share.upload, actions, getLimits: share.getLimits, logger: share.logger },
        others,
        'layer-paste',
      )
    }
    // 稍后隐藏两层（若无内容）。
    setTimeout(() => setPageDrag(false), 2000)
  }

  document.addEventListener('dragenter', onDragEnter, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)
  document.addEventListener('paste', onPaste, true)
}
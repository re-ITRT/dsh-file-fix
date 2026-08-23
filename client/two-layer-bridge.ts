/** 两层 UI 的模块级桥：controller（paste/drop 拦截）↔ TwoLayerRail（渲染与处理）。
 * 避免跨模块 store 双实例问题——文件通过模块级回调传递，UI 用本地 state。
 */

import type { UploadLimits, UploadedFile } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import type { UploadItem } from './store.ts'
import type { LoggerLike } from './upload-controller.ts'

/** controller 需要的处理面（由 TwoLayerRail 提供）。 */
export interface TwoLayerHandle {
  /** 处理一批文件（paste 分流 / 空白 drop）。 */
  handleFiles: (files: readonly File[], via: string) => void
  /** 图片注入（图像层，走官方链路）。 */
  addImages: (files: readonly File[]) => void
}

let twoLayerHandle: TwoLayerHandle | null = null
const handleListeners = new Set<() => void>()

export function setTwoLayerHandle(handle: TwoLayerHandle): void {
  twoLayerHandle = handle
  for (const fn of [...handleListeners]) fn()
}

export function getTwoLayerHandle(): TwoLayerHandle | null {
  return twoLayerHandle
}

export function subscribeTwoLayerHandle(fn: () => void): () => void {
  handleListeners.add(fn)
  return () => { handleListeners.delete(fn) }
}

/** 当前 session id（TwoLayerRail 渲染时更新）。 */
let currentSessionId: string | undefined
export function setBridgeSessionId(sessionId: string | undefined): void {
  currentSessionId = sessionId
}
export function getBridgeSessionId(): string | undefined {
  return currentSessionId
}

/** 页面级拖拽/粘贴激活状态（显示两层）。 */
let pageDrag = false
const pageDragListeners = new Set<() => void>()
export function setPageDrag(value: boolean): void {
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

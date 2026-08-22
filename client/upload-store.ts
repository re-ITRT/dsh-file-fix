/** 模块级上传 store：两层 UI 与 📎 选择按钮共享的单一实例。
 * 之所以不用 slot store seat（conversation.input.attachments 是官方 single slot，
 * SlotMap 未声明 store，shadow 时无法带 store 参数），改为 apply 时创建 root 实例，
 * 组件经 useSyncExternalStore 读取、actions 直接调用。
 */

import { createUploadStore } from './store.ts'
import type { BakedUploadActions, UploadState } from './store.ts'

/** 模块级单一实例（root scope；apply 时初始化）。 */
interface UploadStoreInstance {
  actions: BakedUploadActions
  getSnapshot: () => UploadState
  subscribe: (fn: () => void) => () => void
}

let instance: UploadStoreInstance | null = null

/** 把 engine create() 的产物规范化为最小实例面（绕过 bundler 解析的类型退化）。 */
function normalize(created: unknown): UploadStoreInstance {
  const c = created as {
    actions: BakedUploadActions
    getSnapshot: () => UploadState
    subscribe: (fn: () => void) => () => void
  }
  return { actions: c.actions, getSnapshot: c.getSnapshot, subscribe: c.subscribe }
}

/** apply 时初始化（幂等）。 */
export function ensureUploadStoreInstance(): void {
  if (instance !== null) return
  instance = normalize(createUploadStore().create())
}

export function getUploadStoreActions(): BakedUploadActions {
  if (instance === null) instance = normalize(createUploadStore().create())
  return instance.actions
}

export function getUploadStoreSnapshot(): UploadState {
  return instance?.getSnapshot() ?? { items: [], notice: null }
}

export function subscribeUploadStore(fn: () => void): () => void {
  return instance?.subscribe(fn) ?? (() => {})
}

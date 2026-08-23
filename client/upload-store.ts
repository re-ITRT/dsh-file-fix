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

/** 全局单例 key：确保所有模块（即使被 esbuild 拆成多份）共享同一实例。 */
const GLOBAL_KEY = '__DSH_FILEFIX_STORE__'

interface GlobalStoreHolder {
  instance: UploadStoreInstance | null
}

function getHolder(): GlobalStoreHolder {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as { [GLOBAL_KEY]?: GlobalStoreHolder }
  g[GLOBAL_KEY] ??= { instance: null }
  return g[GLOBAL_KEY]!
}

/** 把 engine create() 的产物规范化为最小实例面（绕过 bundler 解析的类型退化）。 */
function normalize(created: unknown): UploadStoreInstance {
  const c = created as {
    actions: BakedUploadActions
    getSnapshot: () => UploadState
    subscribe: (fn: () => void) => () => void
  }
  return { actions: c.actions, getSnapshot: c.getSnapshot, subscribe: c.subscribe }
}

function getInstance(): UploadStoreInstance | null {
  return getHolder().instance
}
function setInstance(value: UploadStoreInstance): void {
  getHolder().instance = value
}

/** apply 时初始化（幂等）。 */
export function ensureUploadStoreInstance(): void {
  if (getInstance() !== null) return
  setInstance(normalize(createUploadStore().create()))
}

export function getUploadStoreActions(): BakedUploadActions {
  if (getInstance() === null) setInstance(normalize(createUploadStore().create()))
  return getInstance()!.actions
}

export function getUploadStoreSnapshot(): UploadState {
  return getInstance()?.getSnapshot() ?? { items: [], notice: null }
}

export function subscribeUploadStore(fn: () => void): () => void {
  return getInstance()?.subscribe(fn) ?? (() => {})
}
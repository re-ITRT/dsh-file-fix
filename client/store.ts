/** 统一上传 rail 的声明式 store：items 三态 + 提示文案。 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export type UploadStatus = 'uploading' | 'done' | 'error'

export interface UploadItem {
  /** 客户端本地 id。 */
  id: string
  name: string
  size: number
  mediaType: string
  /** base64 字节（重试用）。 */
  data: string
  status: UploadStatus
  /** 附件库 id（上传成功后回填）。 */
  attachmentId?: string
  /** 失败/展示文案。 */
  error?: string
  /** 图片缩略图 data URL。 */
  thumbnail?: string
}

export interface UploadState {
  items: UploadItem[]
  notice: string | null
}

/** 声明式 action 形状（官方范式：draft 首参 + 显式剩余参数）。 */
export type UploadActions = {
  addUploading: (draft: UploadState, item: UploadItem) => void
  markDone: (draft: UploadState, id: string, attachmentId: string, size: number) => void
  markError: (draft: UploadState, id: string, error: string) => void
  setThumbnail: (draft: UploadState, id: string, thumbnail: string) => void
  removeItem: (draft: UploadState, id: string) => void
  clearAll: (draft: UploadState) => void
  setNotice: (draft: UploadState, notice: string | null) => void
}

export const createUploadStore = (): EngineStoreHandle<UploadState, UploadActions> => defineStore({
  init: (): UploadState => ({ items: [], notice: null }),
  actions: {
    addUploading: (draft: UploadState, item: UploadItem) => { draft.items.push(item) },
    markDone: (draft: UploadState, id: string, attachmentId: string, size: number) => {
      const item = draft.items.find(entry => entry.id === id)
      if (item !== undefined) {
        item.status = 'done'
        item.attachmentId = attachmentId
        item.size = size
        item.error = undefined
      }
    },
    markError: (draft: UploadState, id: string, error: string) => {
      const item = draft.items.find(entry => entry.id === id)
      if (item !== undefined) {
        item.status = 'error'
        item.error = error
      }
    },
    setThumbnail: (draft: UploadState, id: string, thumbnail: string) => {
      const item = draft.items.find(entry => entry.id === id)
      if (item !== undefined) item.thumbnail = thumbnail
    },
    removeItem: (draft: UploadState, id: string) => {
      draft.items = draft.items.filter(item => item.id !== id)
    },
    clearAll: (draft: UploadState) => {
      draft.items = []
    },
    setNotice: (draft: UploadState, notice: string | null) => { draft.notice = notice },
  },
})

/** 组件侧看到的 baked actions（draft 已剥除）。 */
export type BakedUploadActions = {
  addUploading: (item: UploadItem) => void
  markDone: (id: string, attachmentId: string, size: number) => void
  markError: (id: string, error: string) => void
  setThumbnail: (id: string, thumbnail: string) => void
  removeItem: (id: string) => void
  clearAll: () => void
  setNotice: (notice: string | null) => void
}

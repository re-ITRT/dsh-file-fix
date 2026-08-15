/** 统一上传 rail 的声明式 store：items 三态 + 提示文案。 */

import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

export type UploadStatus = 'uploading' | 'done' | 'error'

export interface UploadItem {
  /** 客户端生成的一次上传 id（一次重试复用同一 id）。 */
  id: string
  /** 清洗前的显示名。 */
  name: string
  size: number
  mediaType: string
  /** base64 编码的文件字节（重试时复用）。 */
  data: string
  status: UploadStatus
  /** 成功后的工作区相对路径。 */
  relPath?: string
  /** 失败原因（可读文案）。 */
  error?: string
  /** 图片缩略图 data URL（降采样队列产出）。 */
  thumbnail?: string
}

export interface UploadState {
  items: UploadItem[]
  /** rail 下方的一次性提示（批量拒绝/异常），null 表示无提示。 */
  notice: string | null
}

/** 声明形态：每个 action 的第一个参数是 draft（defineStore 的契约）。 */
export type UploadActions = {
  addUploading: (draft: UploadState, item: UploadItem) => void
  markDone: (draft: UploadState, id: string, relPath: string, size: number) => void
  markError: (draft: UploadState, id: string, error: string) => void
  setThumbnail: (draft: UploadState, id: string, thumbnail: string) => void
  removeItem: (draft: UploadState, id: string) => void
  setNotice: (draft: UploadState, notice: string | null) => void
}

/** 组件侧看到的 baked actions（draft 已剥除）。 */
export type BakedUploadActions = {
  addUploading: (item: UploadItem) => void
  markDone: (id: string, relPath: string, size: number) => void
  markError: (id: string, error: string) => void
  setThumbnail: (id: string, thumbnail: string) => void
  removeItem: (id: string) => void
  setNotice: (notice: string | null) => void
}

export const createUploadStore = () => defineStore<UploadState, UploadActions>({
  init: () => ({ items: [], notice: null }),
  actions: {
    addUploading: (d, item) => { d.items.push(item) },
    markDone: (d, id, relPath, size) => {
      const item = d.items.find(entry => entry.id === id)
      if (item !== undefined) {
        item.status = 'done'
        item.relPath = relPath
        item.size = size
        item.error = undefined
      }
    },
    markError: (d, id, error) => {
      const item = d.items.find(entry => entry.id === id)
      if (item !== undefined) {
        item.status = 'error'
        item.error = error
      }
    },
    setThumbnail: (d, id, thumbnail) => {
      const item = d.items.find(entry => entry.id === id)
      if (item !== undefined) item.thumbnail = thumbnail
    },
    removeItem: (d, id) => {
      const at = d.items.findIndex(entry => entry.id === id)
      if (at >= 0) d.items.splice(at, 1)
    },
    setNotice: (d, notice) => { d.notice = notice },
  },
})

export type UploadStore = ReturnType<typeof createUploadStore>

/** dsh-file-fix 线类型：uploadux 命名空间端点 + 会话事件载荷。 */

/** 部署级上传限制（客户端预检与展示共用）。 */
export interface UploadLimits {
  maxFileBytes: number
  maxFilesPerBatch: number
  maxBatchBytes: number
}

/** 一个已入附件库的文件。attachmentId = 内容寻址 sha256。 */
export interface UploadedFile {
  attachmentId: string
  name: string
  mediaType: string
  size: number
}

/** uploadux/persistFile 请求：base64 字节 + 元数据。 */
export interface PersistFileRequest {
  sessionId: string
  name: string
  mediaType: string
  data: string
}

export type PersistFailureCode =
  | 'empty'
  | 'too-large'
  | 'invalid-name'
  | 'write-failed'

/** persistFile 结果：成功返回附件描述。 */
export type PersistFileOutcome =
  | { ok: true; file: UploadedFile }
  | { ok: false; code: PersistFailureCode; detail?: string }

/** uploadux/removeFile 请求。 */
export interface RemoveFileRequest {
  sessionId: string
  attachmentId: string
}

export type RemoveFileOutcome =
  | { ok: true; absent: boolean }
  | { ok: false; code: 'invalid-path' | 'remove-failed'; detail?: string }

/** uploadux/markPending 请求：把已上传文件挂到会话的下一次用户发送。 */
export interface MarkPendingRequest {
  sessionId: string
  files: UploadedFile[]
}

export type MarkPendingOutcome = { ok: true } | { ok: false; code: 'session-not-found' }

/** uploadux/unmarkPending 请求：发送前移除 rail 里的文件时撤销挂载。 */
export interface UnmarkPendingRequest {
  sessionId: string
  attachmentId: string
}

export type UnmarkPendingOutcome = { ok: true } | { ok: false; code: 'session-not-found' }

/** 自定义会话事件：某条用户消息携带的文件列表（ignorable 标记保证跨版本重放安全）。 */
export interface FilesAttachedEventData {
  messageId: string
  files: UploadedFile[]
}

/** 文件挂载条目（listFiles 结果单元）。 */
export interface FilesAttachedEntry {
  messageId: string
  seq: number
  files: UploadedFile[]
}

/** 视觉辅助候选 provider（设置页下拉）。 */
export interface VisionCandidateProvider {
  provider: string
  displayName: string
  models: { id: string; name: string; image: boolean }[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'uploadux/files': FilesAttachedEventData
  }
}

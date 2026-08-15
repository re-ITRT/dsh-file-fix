/** dsh-upload-ux 线类型：upload 命名空间三个端点的请求/结果。 */

/** 部署级上传限制（客户端预检 + 设置展示共用同一份）。 */
export interface UploadLimits {
  /** 单文件字节上限。 */
  maxFileBytes: number
  /** 单批文件数上限。 */
  maxFilesPerBatch: number
  /** 单批总字节上限。 */
  maxBatchBytes: number
}

/** upload/persistFile 请求：base64 编码的文件字节 + 元数据。 */
export interface PersistFileRequest {
  /** 目标会话 id（host 用它解析工作区目录）。 */
  sessionId: string
  /** 原始文件名（host 清洗：剥路径、去控制字符、截断）。 */
  name: string
  /** 浏览器声明的 MIME 类型，仅记录不做校验。 */
  mediaType: string
  /** base64 编码的文件字节。 */
  data: string
}

/** persistFile 的业务结果：成功带相对路径，失败带稳定 code。 */
export type PersistFileOutcome =
  | { ok: true; relPath: string; size: number }
  | { ok: false; code: PersistFailureCode; detail?: string }

export type PersistFailureCode =
  | 'session-not-found'
  | 'no-workspace'
  | 'too-large'
  | 'invalid-name'
  | 'empty'
  | 'write-failed'

/** upload/remove 请求。 */
export interface RemoveFileRequest {
  sessionId: string
  /** 工作区内相对路径（必须由 persistFile 返回过）。 */
  relPath: string
}

/** remove 的业务结果。 */
export type RemoveFileOutcome =
  | { ok: true; absent: boolean }
  | { ok: false; code: RemoveFailureCode; detail?: string }

export type RemoveFailureCode =
  | 'session-not-found'
  | 'no-workspace'
  | 'invalid-path'
  | 'remove-failed'

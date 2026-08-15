/** 插件配置：上传限制与落盘目录名，全部可在 cordis.yml 的 config 段覆盖。 */

import s from '@deepseek-ai/schemastery'

export interface Config {
  /** 单文件字节上限（默认 50 MB）。 */
  maxFileBytes: number
  /** 单批文件数上限。 */
  maxFilesPerBatch: number
  /** 单批总字节上限（默认 200 MB）。 */
  maxBatchBytes: number
  /** 会话工作区内的落盘目录名。 */
  dirName: string
}

export const Config: s<Config> = s.object({
  maxFileBytes: s.number().step(1).min(1).default(50 * 1024 * 1024),
  maxFilesPerBatch: s.number().step(1).min(1).default(20),
  maxBatchBytes: s.number().step(1).min(1).default(200 * 1024 * 1024),
  dirName: s.string().min(1).default('attachments'),
})

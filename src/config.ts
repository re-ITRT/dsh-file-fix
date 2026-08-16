/** 插件配置：上传限制 + 附件读取上限。可在 cordis.yml 的 config 段覆盖。 */

import s from '@deepseek-ai/schemastery'

export interface Config {
  /** 单文件字节上限（默认 50 MB）。 */
  maxFileBytes: number
  /** 单批文件数上限。 */
  maxFilesPerBatch: number
  /** 单批总字节上限。 */
  maxBatchBytes: number
  /** read_attachment 单次返回的文本字节上限（默认 128 KB）。 */
  maxReadBytes: number
}

export const Config: s<Config> = s.object({
  maxFileBytes: s.number().step(1).min(1).default(50 * 1024 * 1024),
  maxFilesPerBatch: s.number().step(1).min(1).default(20),
  maxBatchBytes: s.number().step(1).min(1).default(200 * 1024 * 1024),
  maxReadBytes: s.number().step(1).min(1).default(128 * 1024),
})

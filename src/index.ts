/** dsh-upload-ux host 入口：挂载 upload Typert Remote 服务。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { UploadService } from './remote.ts'

export { Config } from './config.ts'

export const name = 'dsh-upload-ux'

/** 依赖服务就绪后 apply 才执行。 */
export const inject = ['sessionPersistence']

export function apply(ctx: Context, config: Config) {
  ctx.logger.info(
    '[dsh-upload-ux] host loaded, limits={ maxFileBytes: %d, maxFilesPerBatch: %d, maxBatchBytes: %d, dirName: %s }',
    config.maxFileBytes, config.maxFilesPerBatch, config.maxBatchBytes, config.dirName,
  )
  ctx.plugin(UploadService, config)
}

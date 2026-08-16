/** dsh-upload-ux host 入口：附件库 + uploadux Remote + 会话桥 + 工具 + 下载路由。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { installAttachmentBridge } from './attach.ts'
import { registerDownloadRoute } from './http.ts'
import { UploadService } from './remote.ts'
import { FileAttachmentStore } from './store.ts'
import { registerPlaceAttachmentTool, registerReadAttachmentTool } from './tool.ts'

export { Config } from './config.ts'

export const name = 'dsh-upload-ux'

/** 硬依赖：会话持久化（事件追加）。tools/webServer 可选（无 web 面部署仍可用）。 */
export const inject = ['sessionPersistence']

export function apply(ctx: Context, config: Config): void {
  // Service 构造函数即时自注册（provider 归属本 fiber，随 fiber 自动清理）。
  const store = new FileAttachmentStore(ctx, {})
  const service = new UploadService(ctx, config)
  ctx.logger.info('[dsh-upload-ux] attachment store at %s', store.root)

  installAttachmentBridge(ctx, service)
  registerReadAttachmentTool(ctx, store, config)
  registerPlaceAttachmentTool(ctx, store, config)
  registerDownloadRoute(ctx, store)

  ctx.logger.info(
    '[dsh-upload-ux] host loaded: limits %d bytes/file, %d files/batch, %d bytes/batch',
    config.maxFileBytes, config.maxFilesPerBatch, config.maxBatchBytes,
  )
}

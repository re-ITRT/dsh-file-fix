/** dsh-file-fix host 入口：附件库 + filefix Remote + 会话桥 + 工具 + 下载路由。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { installAttachmentBridge } from './attach.ts'
import { installVisionRoute } from './vision.ts'
import { installVisionStateTracking, rebuildVisionState } from './vision-state.ts'
import { registerDownloadRoute } from './http.ts'
import { UploadService } from './remote.ts'
import { FileAttachmentStore } from './store.ts'
import { registerPlaceAttachmentTool, registerReadAttachmentTool } from './tool.ts'
import { runCleanup, readCleanupConfig, setSessionLister, cleanupStatsOf } from './cleanup.ts'
import type { CleanupStats } from './cleanup.ts'

export { Config } from './config.ts'

export const name = 'dsh-file-fix'

/** 硬依赖：会话持久化（事件追加）。tools/webServer 可选（无 web 面部署仍可用）。 */
export const inject = ['sessionPersistence']

export function apply(ctx: Context, config: Config): void {
  // Service 构造函数即时自注册（provider 归属本 fiber，随 fiber 自动清理）。
  const store = new FileAttachmentStore(ctx, {})
  const service = new UploadService(ctx, config)
  ctx.logger.info('[dsh-file-fix] attachment store at %s', store.root)

  installAttachmentBridge(ctx, service)
  installVisionStateTracking(ctx)
  ctx.on('agent/session-start', ({ agent }) => {
    void rebuildVisionState(ctx, agent.id)
  })
  registerReadAttachmentTool(ctx, store, config)
  registerPlaceAttachmentTool(ctx, store, config)
  installVisionRoute(ctx, store)
  registerDownloadRoute(ctx, store)

  // 清理策略（2+3 联动）：会话级联 + 定时自动 GC。
  const persistence = ctx.get('sessionPersistence') as
    | { list?: () => Promise<readonly { id: unknown }[]> }
    | undefined
  if (persistence?.list !== undefined) {
    setSessionLister(() => persistence.list!().then(headers => headers as readonly { id: unknown }[]))
  }
  const cleanupCfg = readCleanupConfig()
  if (cleanupCfg.enabled) {
    const intervalMs = Math.max(1, cleanupCfg.gcIntervalHours) * 3600 * 1000
    const timer = setInterval(() => {
      void runCleanup(store).then(result => {
        if (result.removedBlobs > 0 || result.removedAssociations > 0) {
          ctx.logger.info(
            '[dsh-file-fix] cleanup: removed %d blobs (%d bytes), %d association records',
            result.removedBlobs, result.removedBytes, result.removedAssociations,
          )
        }
      }).catch(error => ctx.logger.warn('[dsh-file-fix] cleanup failed: %o', error))
    }, intervalMs)
    ctx.effect(() => () => { clearInterval(timer) }, 'dsh-file-fix: cleanup timer')
    void runCleanup(store).then(result => {
      ctx.logger.info(
        '[dsh-file-fix] startup cleanup done: removed %d blobs (%d bytes), %d association records',
        result.removedBlobs, result.removedBytes, result.removedAssociations,
      )
    }).catch(error => ctx.logger.warn('[dsh-file-fix] startup cleanup failed: %o', error))
  }

  void cleanupStatsOf(store).then((stats: CleanupStats) => {
    ctx.logger.info(
      '[dsh-file-fix] attachments: %d blobs / %d associations / %d bytes',
      stats.manifestCount, stats.associationCount, stats.totalBytes,
    )
  }).catch(() => {})

  ctx.logger.info(
    '[dsh-file-fix] host loaded: limits %d bytes/file, %d files/batch, %d bytes/batch',
    config.maxFileBytes, config.maxFilesPerBatch, config.maxBatchBytes,
  )
}
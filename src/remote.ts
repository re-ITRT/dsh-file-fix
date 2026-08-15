/** uploadux 命名空间的 Typert Remote 服务：persistFile / limits / remove。 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { Config } from './config.ts'
import { persistFileBytes, removeFileBytes } from './persist.ts'
import type {
  PersistFileOutcome,
  PersistFileRequest,
  RemoveFileOutcome,
  RemoveFileRequest,
  UploadLimits,
} from './types.ts'

/** 会话 id → 工作区目录的解析：从持久化 header 里查 cwd。 */
async function workspaceOf(
  persistence: SessionPersistence,
  sessionId: string,
): Promise<string | undefined> {
  const headers = await persistence.list()
  return headers.find(header => String(header.id) === sessionId)?.cwd
}

export class UploadService extends TypertRemoteService {
  static inject = ['sessionPersistence']

  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, 'uploadux')
  }

  @Remote('limits')
  limits(): UploadLimits {
    return {
      maxFileBytes: this.config.maxFileBytes,
      maxFilesPerBatch: this.config.maxFilesPerBatch,
      maxBatchBytes: this.config.maxBatchBytes,
    }
  }

  @Remote('persistFile')
  async persistFile(request: PersistFileRequest): Promise<PersistFileOutcome> {
    const started = Date.now()
    const bytes = Buffer.from(request.data, 'base64')
    const ctx = this.ctx

    if (bytes.byteLength === 0) {
      ctx.logger.warn('[dsh-upload-ux] persistFile rejected: EMPTY name=%s', request.name)
      return { ok: false, code: 'empty' }
    }
    if (bytes.byteLength > this.config.maxFileBytes) {
      ctx.logger.warn(
        '[dsh-upload-ux] persistFile rejected: TOO_LARGE name=%s bytes=%d limit=%d',
        request.name, bytes.byteLength, this.config.maxFileBytes,
      )
      return { ok: false, code: 'too-large', detail: `max ${this.config.maxFileBytes} bytes` }
    }

    let cwd: string | undefined
    try {
      cwd = await workspaceOf(this.ctx.sessionPersistence, request.sessionId)
    } catch (error) {
      ctx.logger.error('[dsh-upload-ux] persistFile session lookup failed: %o', error)
      return { ok: false, code: 'session-not-found' }
    }
    if (cwd === undefined) {
      ctx.logger.warn('[dsh-upload-ux] persistFile rejected: SESSION_NOT_FOUND session=%s', request.sessionId)
      return { ok: false, code: 'session-not-found' }
    }

    ctx.logger.info(
      '[dsh-upload-ux] persistFile session=%s name=%s mediaType=%s bytes=%d',
      request.sessionId, request.name, request.mediaType, bytes.byteLength,
    )

    try {
      const result = await persistFileBytes(cwd, this.config.dirName, request.name, request.data)
      ctx.logger.info(
        '[dsh-upload-ux] persistFile ok -> %s (%d bytes) in %dms',
        result.relPath, result.size, Date.now() - started,
      )
      return { ok: true, ...result }
    } catch (error) {
      ctx.logger.error('[dsh-upload-ux] persistFile write failed: %o', error)
      return { ok: false, code: 'write-failed', detail: (error as Error).message }
    }
  }

  @Remote('removeFile')
  async removeFile(request: RemoveFileRequest): Promise<RemoveFileOutcome> {
    let cwd: string | undefined
    try {
      cwd = await workspaceOf(this.ctx.sessionPersistence, request.sessionId)
    } catch (error) {
      this.ctx.logger.error('[dsh-upload-ux] remove session lookup failed: %o', error)
      return { ok: false, code: 'session-not-found' }
    }
    if (cwd === undefined) {
      return { ok: false, code: 'session-not-found' }
    }

    try {
      const ok = await removeFileBytes(cwd, this.config.dirName, request.relPath)
      this.ctx.logger.info('[dsh-upload-ux] remove %s -> %s', request.relPath, ok ? 'ok' : 'not-found')
      return { ok: true, absent: !ok }
    } catch (error) {
      this.ctx.logger.error('[dsh-upload-ux] remove %s failed: %o', request.relPath, error)
      return { ok: false, code: 'remove-failed', detail: (error as Error).message }
    }
  }
}

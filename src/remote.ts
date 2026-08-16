/** uploadux 命名空间 Typert Remote 服务：persistFile / limits / removeFile / markPending。 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.ts'
import { mediaTypeOf, sanitizeName } from './name.ts'
import { readVisionConfig, writeVisionConfig } from './vision.ts'
import type { VisionConfig } from './vision.ts'
import type { FilesAttachedEntry, VisionCandidateProvider } from './types.ts'
import type { FileAttachmentStore } from './store.ts'
import type {
  MarkPendingOutcome,
  MarkPendingRequest,
  PersistFileOutcome,
  PersistFileRequest,
  RemoveFileOutcome,
  RemoveFileRequest,
  UnmarkPendingOutcome,
  UnmarkPendingRequest,
  UploadLimits,
  UploadedFile,
} from './types.ts'

export class UploadService extends TypertRemoteService {
  static inject = ['uploaduxStore']

/** 已挂载文件：messageId → {seq, files}（seq 供客户端按用户消息定位气泡）。 */
  readonly attached = new Map<string, { seq: number; files: UploadedFile[] }>()

  /** 待挂载文件：会话下一次 user 消息进入 inbox 时消费。 */
  readonly pending = new Map<string, UploadedFile[]>()

  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, 'uploadux')
  }

  get store(): FileAttachmentStore {
    return this.ctx.uploaduxStore
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

    if (bytes.byteLength === 0) {
      this.ctx.logger.warn('[dsh-upload-ux] persistFile rejected: EMPTY name=%s', request.name)
      return { ok: false, code: 'empty' }
    }
    if (bytes.byteLength > this.config.maxFileBytes) {
      this.ctx.logger.warn(
        '[dsh-upload-ux] persistFile rejected: TOO_LARGE name=%s bytes=%d limit=%d',
        request.name, bytes.byteLength, this.config.maxFileBytes,
      )
      return { ok: false, code: 'too-large', detail: `max ${this.config.maxFileBytes} bytes` }
    }
    const name = sanitizeName(request.name)
    if (name === '') {
      return { ok: false, code: 'invalid-name' }
    }

    const mediaType = mediaTypeOf(request)

    this.ctx.logger.info(
      '[dsh-upload-ux] persistFile session=%s name=%s mediaType=%s bytes=%d',
      request.sessionId, name, mediaType, bytes.byteLength,
    )

    try {
      const file = await this.store.save({
        name,
        mediaType,
        sessionId: request.sessionId,
        bytes,
      })
      this.ctx.logger.info(
        '[dsh-upload-ux] persistFile ok id=%s name=%s %dms',
        file.attachmentId, name, Date.now() - started,
      )
      return { ok: true, file }
    } catch (error) {
      this.ctx.logger.error('[dsh-upload-ux] persistFile write failed: %o', error)
      return { ok: false, code: 'write-failed', detail: (error as Error).message }
    }
  }

  @Remote('removeFile')
  async removeFile(request: RemoveFileRequest): Promise<RemoveFileOutcome> {
    try {
      const removed = await this.store.remove(request.attachmentId)
      this.ctx.logger.info(
        '[dsh-upload-ux] removeFile %s -> %s',
        request.attachmentId, removed ? 'ok' : 'not-found',
      )
      return { ok: true, absent: !removed }
    } catch (error) {
      this.ctx.logger.error('[dsh-upload-ux] removeFile %s failed: %o', request.attachmentId, error)
      return { ok: false, code: 'remove-failed', detail: (error as Error).message }
    }
  }

  @Remote('listFiles')
  async listFiles(request: { sessionId: string }): Promise<{ ok: true; items: FilesAttachedEntry[] }> {
    const items: FilesAttachedEntry[] = []
    for (const [messageId, entry] of this.attached) {
      items.push({ messageId, seq: entry.seq, files: entry.files })
    }
    void request
    return { ok: true, items }
  }

  @Remote('markPending')
  async markPending(request: MarkPendingRequest): Promise<MarkPendingOutcome> {
    const existing = this.pending.get(request.sessionId) ?? []
    this.pending.set(request.sessionId, [...existing, ...request.files])
    this.ctx.logger.info(
      '[dsh-upload-ux] markPending session=%s files=%d',
      request.sessionId, request.files.length,
    )
    return { ok: true }
  }

  @Remote('getVisionConfig')
  async getVisionConfig(): Promise<{ ok: true; config: VisionConfig }> {
    return { ok: true, config: readVisionConfig() }
  }

  @Remote('setVisionConfig')
  async setVisionConfig(request: { config: VisionConfig }): Promise<{ ok: true }> {
    writeVisionConfig(request.config ?? {})
    this.ctx.logger.info('[dsh-upload-ux] vision config updated: %o', request.config)
    return { ok: true }
  }

  @Remote('testVisionModel')
  async testVisionModel(request: { provider: string; model: string }): Promise<{
    ok: boolean
    image: boolean
    error?: string
  }> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return { ok: false, image: false, error: 'llm service unavailable' }
    try {
      const info = await llm.resolveModelInfo(request.provider, request.model)
      return { ok: true, image: info.inputModalities?.includes('image') === true }
    } catch (error) {
      return { ok: false, image: false, error: (error as Error).message }
    }
  }

  @Remote('listVisionCandidates')
  async listVisionCandidates(): Promise<{ ok: true; providers: VisionCandidateProvider[] }> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return { ok: true, providers: [] }
    const providers: VisionCandidateProvider[] = []
    for (const info of llm.listProviders()) {
      const models = await llm.listModels(info.id).catch(() => [])
      providers.push({
        provider: info.id,
        displayName: info.name,
        models: models.map(model => ({
          id: model.id,
          name: model.name,
          image: model.inputModalities?.includes('image') === true,
        })),
      })
    }
    return { ok: true, providers }
  }

  @Remote('unmarkPending')
  async unmarkPending(request: UnmarkPendingRequest): Promise<UnmarkPendingOutcome> {
    const existing = this.pending.get(request.sessionId)
    if (existing === undefined) return { ok: true }
    this.pending.set(request.sessionId, existing.filter(file => file.attachmentId !== request.attachmentId))
    this.ctx.logger.info(
      '[dsh-upload-ux] unmarkPending session=%s attachment=%s',
      request.sessionId, request.attachmentId,
    )
    return { ok: true }
  }

  /** 取走会话的待挂文件（入 inbox 时调用）。 */
  takePending(sessionId: string): UploadedFile[] {
    const files = this.pending.get(sessionId) ?? []
    this.pending.delete(sessionId)
    return files
  }
}

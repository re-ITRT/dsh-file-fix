/** 上传管线：预检 → 读字节 → persistFile 入附件库 → markPending 挂到下一次发送。 */

import type { UploadLimits, UploadedFile } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import type { BakedUploadActions, UploadItem } from './store.ts'
import { downscaleThumbnail, humanSize } from './thumbnail.ts'

export interface LoggerLike {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface IntakeDeps {
  sessionId: string
  remote: UploadRemote
  actions: BakedUploadActions
  getLimits: () => UploadLimits | null
  logger: LoggerLike
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function codeToText(code: string): string {
  switch (code) {
    case 'too-large': return '文件超过大小限制'
    case 'empty': return '文件为空'
    case 'invalid-name': return '文件名无效'
    case 'write-failed': return '写入失败'
    default: return code
  }
}

/**
 * 单个文件的上传：字节入附件库 → 回写 attachmentId。重试复用同一 item 数据。
 */
export async function uploadOne(
  deps: IntakeDeps,
  item: UploadItem,
  via: string,
): Promise<UploadedFile | undefined> {
  deps.logger.info('[dsh-upload-ux] upload start %s (%s)', item.name, humanSize(item.size))
  const started = Date.now()
  try {
    const result = await deps.remote.persistFile({
      sessionId: deps.sessionId,
      name: item.name,
      mediaType: item.mediaType,
      data: item.data,
    })
    if (!result.ok) {
      const code = (result.error as { code?: string }).code ?? 'remote-failure'
      deps.actions.markError(item.id, codeToText(code))
      deps.logger.warn('[dsh-upload-ux] upload failed %s: %s', item.name, code)
      return undefined
    }
    const outcome = result.value
    if (!outcome.ok) {
      deps.actions.markError(item.id, codeToText(outcome.code))
      deps.logger.warn('[dsh-upload-ux] upload failed %s: %s', item.name, outcome.code)
      return undefined
    }
    deps.actions.markDone(item.id, outcome.file.attachmentId, outcome.file.size)
    deps.logger.info(
      '[dsh-upload-ux] upload ok %s -> %s %dms via=%s',
      item.name, outcome.file.attachmentId, Date.now() - started, via,
    )
    return outcome.file
  } catch (error) {
    deps.actions.markError(item.id, codeToText('write-failed'))
    deps.logger.error('[dsh-upload-ux] upload exception %s: %o', item.name, error)
    return undefined
  }
}

/**
 * 整批入口：限制预检（超限整批拒绝）→ 逐文件读字节入 rail → 逐个上传，
 * 成功后挂载到会话的下一次用户发送。
 */
export async function intakeFiles(deps: IntakeDeps, files: readonly File[], via: string): Promise<void> {
  const { actions, getLimits, logger } = deps
  console.log('[dsh-upload-ux:debug] intakeFiles', via, files.length, files.map(f => f.name).join(','))
  logger.info(
    '[dsh-upload-ux] intake files=%d images=%d others=%d via=%s',
    files.length,
    files.filter(file => file.type.startsWith('image/')).length,
    files.filter(file => !file.type.startsWith('image/')).length,
    via,
  )

  const limits = getLimits()
  if (limits !== null) {
    if (files.length > limits.maxFilesPerBatch) {
      actions.setNotice(`一次最多上传 ${limits.maxFilesPerBatch} 个文件`)
      logger.warn('[dsh-upload-ux] intake rejected: TOO_MANY files=%d limit=%d', files.length, limits.maxFilesPerBatch)
      return
    }
    const oversize = files.find(file => file.size > limits.maxFileBytes)
    if (oversize !== undefined) {
      actions.setNotice(`文件超过大小限制（${humanSize(limits.maxFileBytes)}）`)
      logger.warn('[dsh-upload-ux] intake rejected: TOO_LARGE name=%s', oversize.name)
      return
    }
    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (total > limits.maxBatchBytes) {
      actions.setNotice(`批量总大小超过限制（${humanSize(limits.maxBatchBytes)}）`)
      logger.warn('[dsh-upload-ux] intake rejected: BATCH_TOO_LARGE bytes=%d', total)
      return
    }
  }

  const uploaded: UploadedFile[] = []
  for (const file of files) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const data = await readAsDataUrl(file).catch(() => '')
    if (data === '') {
      logger.warn('[dsh-upload-ux] read failed %s', file.name)
      actions.addUploading({ id, name: file.name, size: file.size, mediaType: file.type, data: '', status: 'uploading' })
      actions.markError(id, '读取失败')
      continue
    }
    actions.addUploading({ id, name: file.name, size: file.size, mediaType: file.type, data, status: 'uploading' })
    if (file.type.startsWith('image/')) {
      void downscaleThumbnail(`data:${file.type};base64,${data}`).then(thumbnail => {
        if (thumbnail !== '') actions.setThumbnail(id, thumbnail)
      })
    }
    const result = await uploadOne(deps, { id, name: file.name, size: file.size, mediaType: file.type, data, status: 'uploading' }, via)
    if (result !== undefined) uploaded.push(result)
  }

  if (uploaded.length > 0) {
    console.log('[dsh-upload-ux:debug] calling markPending', via, uploaded.length)
    void deps.remote.markPending({ sessionId: deps.sessionId, files: uploaded }).then(result => {
      console.log('[dsh-upload-ux:debug] markPending result', result.ok ? 'ok' : JSON.stringify(result.error))
      logger.info(
        '[dsh-upload-ux] markPending %s: %d file(s) -> %s',
        via, uploaded.length, result.ok ? 'ok' : `failed ${result.error}`,
      )
    })
  }
}

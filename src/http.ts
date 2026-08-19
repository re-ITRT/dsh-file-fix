/** 附件下载路由：/plugins/dsh-file-fix/download/<attachmentId>。 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FileAttachmentStore } from './store.ts'

const PREFIX = '/plugins/dsh-file-fix/download'

function sendError(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

export function registerDownloadRoute(ctx: Context, store: FileAttachmentStore): void {
  // webServer 在本插件 apply 时可能尚未就绪（host webserver 后初始化），
  // 轮询等待就绪后注册；就绪即注册并停止轮询。
  const tryRegister = (): (() => void) | undefined => {
    const webServer = ctx.get('webServer') as
      | { register: (route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void }
      | undefined
    if (webServer === undefined) return undefined
    const dispose = webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendError(res, 405, 'method not allowed')
          return
        }
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        if (!pathname.startsWith(PREFIX)) {
          sendError(res, 404, 'not found')
          return
        }
        const attachmentId = pathname.slice(PREFIX.length).replace(/^\//, '')
        if (attachmentId === '' || !/^[0-9a-f]{64}$/.test(attachmentId)) {
          sendError(res, 400, 'invalid attachment id')
          return
        }
        const found = await store.read(attachmentId)
        if (found === undefined) {
          sendError(res, 404, 'attachment bytes not retained (upload record exists, content was cleaned up)')
          return
        }
        const fallback = found.row.name.replace(/[^\x20-\x7e]/g, '_')
        res.writeHead(200, {
          'content-type': found.row.mediaType || 'application/octet-stream',
          'content-length': found.bytes.byteLength,
          'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(found.row.name)}`,
          'cache-control': 'private, max-age=31536000, immutable',
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(found.bytes)
      },
    })
    ctx.logger.info('[dsh-file-fix] download route registered at %s', PREFIX)
    return dispose
  }

  const direct = tryRegister()
  if (direct !== undefined) {
    // 随 fiber 生命周期释放（attach 卸载时一并移除路由）
    ctx.effect(() => direct, 'dsh-file-fix: download route')
    return
  }
  ctx.logger.warn('[dsh-file-fix] webServer absent at apply — polling for download route')
  let dispose: (() => void) | undefined
  const timer = setInterval(() => {
    const d = tryRegister()
    if (d !== undefined) {
      clearInterval(timer)
      dispose = d
      ctx.logger.info('[dsh-file-fix] download route registered (deferred)')
    }
  }, 500)
  ctx.effect(() => () => {
    clearInterval(timer)
    dispose?.()
  }, 'dsh-file-fix: download route (deferred cleanup)')
}

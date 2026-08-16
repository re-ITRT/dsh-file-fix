/** 附件下载路由：/plugins/dsh-file-fix/download/<attachmentId>。 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FileAttachmentStore } from './store.ts'

const PREFIX = '/plugins/dsh-file-fix/download/'

function sendError(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

export function registerDownloadRoute(ctx: Context, store: FileAttachmentStore): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    ctx.logger.warn('[dsh-file-fix] webServer absent — download route not registered')
    return
  }
  webServer.register({
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
      const attachmentId = pathname.slice(PREFIX.length)
      if (attachmentId === '' || !/^[0-9a-f]{64}$/.test(attachmentId)) {
        sendError(res, 400, 'invalid attachment id')
        return
      }
      const found = await store.read(attachmentId)
      if (found === undefined) {
        sendError(res, 404, 'attachment not found')
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
}

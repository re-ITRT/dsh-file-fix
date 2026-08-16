/** read_attachment / place_attachment 工具：附件库读取 + 导出到会话工作区。 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { existsSync as existsSyncSync } from 'node:fs'
import type { Config } from './config.ts'
import type { FileAttachmentStore } from './store.ts'

/** UTF-8 可解码且无过多控制字符才当文本返回。 */
function looksTextual(bytes: Buffer): boolean {
  if (bytes.byteLength === 0) return true
  let controls = 0
  for (let i = 0; i < Math.min(bytes.byteLength, 2048); i += 1) {
    const byte = bytes[i]!
    if (byte === 0) return false
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1
  }
  return controls / Math.min(bytes.byteLength, 2048) < 0.05
}

export function registerReadAttachmentTool(ctx: Context, store: FileAttachmentStore, config: Config): void {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger.warn('[dsh-upload-ux] tools service absent — read_attachment not registered')
    return
  }
  tools.register(defineTool({
    name: 'read_attachment',
    description: [
      'Read the content of a file the user uploaded through dsh-upload-ux.',
      'The file lives in the attachment store (independent of the workspace filesystem);',
      'look up its attachment_id from the system message that lists uploaded files.',
      'Text-like content is returned as text; binary content returns size and media type only.',
      'Large files are truncated to one read: pass offset (byte position) to continue,',
      'repeatedly until the returned "more" flag is false.',
    ].join(' '),
    parameters: {
      attachment_id: {
        type: 'string',
        required: true,
        description: 'The content-addressed id of the uploaded file (from the system file list).',
      },
      offset: {
        type: 'integer',
        description: 'Byte offset to start reading from (default 0). Use with "more" to page through large files.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum bytes to read in this call (default: ~48 KB chunk; hard cap: the configured max).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          offset: { type: 'integer', required: true },
          more: { type: 'boolean', required: true },
          text: { type: 'string' },
          binary: { type: 'boolean' },
        },
      },
      render: (_args, value: { name: string; mediaType: string; size: number; offset: number; more: boolean; text?: string; binary?: boolean }) => {
        if (value.text !== undefined) {
          const banner = value.more
            ? `[${value.name} 分段 ${value.offset}-${value.offset + value.text.length}/${value.size} 字节，继续用 offset=${value.offset + value.text.length} 读取]`
            : `[${value.name} ${value.size} 字节，读取完毕]`
          return [{ type: 'text', text: `${banner}\n${value.text}` }]
        }
        return [{
          type: 'text',
          text: `[二进制文件] ${value.name}（${value.mediaType}，${value.size} 字节）—— 无法作为文本读取`,
        }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const id = String(args.attachment_id).trim()
      if (id === '') throw new Error('attachment_id must be a non-empty string')
      const found = await store.read(id)
      if (found === undefined) {
        throw new Error(`attachment "${id}" does not exist in the upload store`)
      }
      if (!looksTextual(found.bytes)) {
        return {
          name: found.row.name,
          mediaType: found.row.mediaType,
          size: found.bytes.byteLength,
          offset: 0,
          more: false,
          binary: true,
        }
      }
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
      const requested = Math.floor(Number(args.limit))
      const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, config.maxReadBytes)
        : config.readChunkBytes
      const slice = found.bytes.subarray(offset, offset + limit)
      const more = offset + slice.byteLength < found.bytes.byteLength
      return {
        name: found.row.name,
        mediaType: found.row.mediaType,
        size: found.bytes.byteLength,
        offset,
        more,
        text: slice.toString('utf8'),
      }
    },
  }))
}

/**
 * place_attachment：把附件库中的文件字节导出到会话工作区（字节级拷贝，文本/二进制通吃）。
 * target_path 相对会话工作区（exec.agent.session.header.cwd）解析，禁止逃逸。
 */
export function registerPlaceAttachmentTool(ctx: Context, store: FileAttachmentStore, config: Config): void {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger.warn('[dsh-upload-ux] tools service absent — place_attachment not registered')
    return
  }
  tools.register(defineTool({
    name: 'place_attachment',
    description: [
      'Copy a user-uploaded file from the attachment store into the session workspace.',
      'Use this when the task needs the uploaded file as a real workspace file',
      '(e.g. firmware to flash, an archive to extract, an image to process).',
      'attachment_id comes from the system message that lists uploaded files;',
      'target_path is relative to the session workspace and must stay inside it.',
      'Existing files at target_path are overwritten.',
    ].join(' '),
    parameters: {
      attachment_id: {
        type: 'string',
        required: true,
        description: 'The content-addressed id of the uploaded file (from the system file list).',
      },
      target_path: {
        type: 'string',
        required: true,
        description: 'Destination path relative to the session workspace (e.g. "firmware.bin" or "assets/img.png").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          targetPath: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          overwritten: { type: 'boolean', required: true },
        },
      },
      render: (_args, value: { name: string; targetPath: string; size: number; overwritten: boolean }) => [{
        type: 'text',
        text: `已将附件 ${value.name}（${value.size} 字节）导出到 ${value.targetPath}${value.overwritten ? '（覆盖已有文件）' : ''}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const id = String(args.attachment_id).trim()
      if (id === '') throw new Error('attachment_id must be a non-empty string')
      const target = String(args.target_path).trim()
      if (target === '') throw new Error('target_path must be a non-empty string')
      const found = await store.read(id)
      if (found === undefined) {
        throw new Error(`attachment "${id}" does not exist in the upload store`)
      }
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined || cwd === '') {
        throw new Error('no session workspace: cannot resolve target_path')
      }
      const root = canonicalPath(cwd)
      const resolved = canonicalPath(resolve(cwd, target))
      const norm = (p: string): string => process.platform === 'win32' ? p.toLowerCase() : p
      if (norm(resolved) !== norm(root) && !norm(resolved).startsWith(norm(root) + sep)) {
        throw new Error(`target_path "${target}" escapes the session workspace (resolved to ${resolved})`)
      }
      const overwritten = existsSyncSync(resolved)
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, found.bytes)
      void config
      return {
        name: found.row.name,
        targetPath: resolved,
        size: found.bytes.byteLength,
        overwritten,
      }
    },
  }))
}

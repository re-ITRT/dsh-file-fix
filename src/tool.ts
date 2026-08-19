/** read_attachment / place_attachment 工具：附件库读取 + 导出到会话工作区。 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { existsSync as existsSyncSync } from 'node:fs'
import type { Config } from './config.ts'
import type { FileAttachmentStore } from './store.ts'
import { touchAccess } from './cleanup.ts'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** UTF-8 可解码且无过多控制字符才当文本返回。 */
/** UTF-8 字节流判文本：前 2048 字节内无 NUL 且控制字符占比 <5%（\t\n\r 除外）。 */
function looksTextualUtf8(bytes: Buffer): boolean {
  if (bytes.byteLength === 0) return true
  let controls = 0
  for (let i = 0; i < Math.min(bytes.byteLength, 2048); i += 1) {
    const byte = bytes[i]!
    if (byte === 0) return false
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1
  }
  return controls / Math.min(bytes.byteLength, 2048) < 0.05
}

/**
 * 解码上传文件为文本：识别 UTF-16 LE/BE 与 UTF-8 BOM（记事本「另存为 UTF-16」
 * 是 Windows 常见操作——ASCII 字符后跟 NUL，按 UTF-8 判必为二进制）；
 * 纯 UTF-8 走控制字符检测。无法判文本时返回 undefined。
 */
function decodeText(bytes: Buffer): string | undefined {
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8')
  }
  if (!looksTextualUtf8(bytes)) return undefined
  return bytes.toString('utf8')
}

export function registerReadAttachmentTool(ctx: Context, store: FileAttachmentStore, config: Config): void {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger.warn('[dsh-file-fix] tools service absent — read_attachment not registered')
    return
  }
  tools.register(defineTool({
    name: 'read_attachment',
    description: [
      'Read the content of a file the user uploaded through dsh-file-fix.',
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
          total: { type: 'integer' },
        },
      },
      render: (_args, value: { name: string; mediaType: string; size: number; offset: number; more: boolean; text?: string; binary?: boolean; total?: number }) => {
        if (value.text !== undefined) {
          const banner = value.more
            ? `[${value.name} 分段 ${value.offset}-${value.offset + value.text.length}/${value.total ?? '?'} 字符，继续用 offset=${value.offset + value.text.length} 读取]`
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
      touchAccess(id)
      const decoded = decodeText(found.bytes)
      if (decoded === undefined) {
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
      // 字符单位切片（UTF-16 按字节切会切半字符）
      const text = decoded.slice(offset, offset + limit)
      const more = offset + limit < decoded.length
      // 大文件镜像：完整内容写入工作区 .dsh-uploadux/reads/（UTF-16 转 UTF-8 后镜像）。
      let mirrorNote = ''
      if (config.readMirrorThreshold > 0 && found.bytes.byteLength > config.readMirrorThreshold) {
        mirrorNote = await mirrorToWorkspace(exec, found)
      }
      return {
        name: found.row.name,
        mediaType: found.row.mediaType,
        size: found.bytes.byteLength,
        offset,
        more,
        total: decoded.length,
        text: text + mirrorNote,
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
    ctx.logger.warn('[dsh-file-fix] tools service absent — place_attachment not registered')
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
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value: { name: string; targetPath: string; size: number; overwritten: boolean; note: string }) => [{
        type: 'text',
        text: `已将附件 ${value.name}（${value.size} 字节）导出到 ${value.targetPath}${value.overwritten ? '（覆盖已有文件）' : ''}。\n${value.note}`,
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
      touchAccess(id)
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
        note: '读取建议：要查看/分析文件内容，请用 read_attachment 按 attachment_id 分段读取（每段约 48 KB，banner 给出下一个 offset）；str_replace_editor view 单次输出上限仅 16000 字符，读大文件（尤其代码/文本）效率极低，请勿用它整读大文件。',
      }
    },
  }))
}

/** 大文件镜像：完整内容写入工作区 .dsh-uploadux/reads/，返回提示文案（失败静默返回空串）。 */
async function mirrorToWorkspace(
  exec: ToolExecution,
  found: { row: { name: string }; bytes: Buffer },
): Promise<string> {
  try {
    const cwd = exec.agent?.session.header.cwd
    if (cwd === undefined || cwd === '') return ''
    const mirrorDir = resolve(cwd, '.dsh-uploadux', 'reads')
    const mirrorPath = resolve(mirrorDir, found.row.name)
    if (!existsSyncSync(mirrorPath)) {
      await mkdir(mirrorDir, { recursive: true })
      await writeFile(mirrorPath, found.bytes)
    }
    return `\n[大文件] 完整内容已镜像到工作区 ".dsh-uploadux/reads/${found.row.name}"（${found.bytes.byteLength} 字节）。读取建议：优先用 read_attachment 按 offset 分段读取（每段约 48 KB，返回的 banner 会给出下一个 offset）；str_replace_editor view 单次输出上限仅 16000 字符，读大文件效率低。`
  } catch {
    return ''
  }
}

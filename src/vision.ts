/** 视觉双路线：
 * - add_image_to_context（仅视觉模型可见）：图片作为 image block 进工具结果 → 模型直接看图
 * - visual_assist（仅无视觉模型可见）：图片 + 问题发给配置的视觉辅助模型 → 返回文字描述
 * - 模态路由：监听 request/header（模型路由权威信号）→ resolveModelInfo → 动态装卸两个工具
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Config } from './config.ts'
import type { FileAttachmentStore } from './store.ts'
import { touchAccess } from './cleanup.ts'

/** 视觉辅助模型配置（独立 JSON，设置页经 remote 读写；不依赖 cordis 静态 config）。 */
export interface VisionConfig {
  provider?: string
  model?: string
}

const VISION_CONFIG_PATH = join(homedir(), '.dsh', 'uploadux-vision.json')

export function readVisionConfig(): VisionConfig {
  try {
    if (existsSync(VISION_CONFIG_PATH)) {
      return JSON.parse(readFileSync(VISION_CONFIG_PATH, 'utf8')) as VisionConfig
    }
  } catch { /* 配置损坏按未配置处理 */ }
  return {}
}

export function writeVisionConfig(config: VisionConfig): void {
  writeFileSync(VISION_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/** PNG/JPEG/GIF/WebP 魔数判定。 */
function isImageBytes(bytes: Buffer): boolean {
  if (bytes.byteLength < 8) return false
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true
  return false
}

interface FoundImage { row: { name: string; mediaType: string }; bytes: Buffer }

/** 校验附件是图片并返回字节。 */
async function requireImage(store: FileAttachmentStore, id: string): Promise<FoundImage> {
  const found = await store.read(id)
  if (found === undefined) throw new Error(`attachment "${id}" does not exist in the upload store`)
  touchAccess(id) // 老化判定：内容读取 = 最近访问
  if (!isImageBytes(found.bytes)) {
    throw new Error(`attachment "${found.row.name}" is not an image (${found.row.mediaType || 'unknown type'})`)
  }
  return found as FoundImage
}

/** 图片存入官方图片附件服务（图片走官方通道：限额/类型白名单/持久化），返回可渲染的 ref。 */
async function saveImageRef(
  ctx: Context,
  found: FoundImage,
): Promise<{ ref: ImageAttachmentRef; mediaType: string }> {
  const attachments = ctx.get('attachments') as
    | { saveImage: (input: { data: Buffer; mediaType: string; name?: string }) => Promise<ImageAttachmentRef> } | undefined
  if (attachments === undefined) {
    throw new Error('image attachment service is not mounted')
  }
  const mediaType = found.row.mediaType.startsWith('image/') ? found.row.mediaType : 'image/png'
  try {
    const ref = await attachments.saveImage({ data: found.bytes, mediaType, name: found.row.name })
    return { ref, mediaType }
  } catch (error: unknown) {
    if (error instanceof AttachmentError) {
      throw new Error(`图片格式不受支持：${found.row.name}（${found.row.mediaType}）——read_image 仅支持 PNG/JPEG/WebP/GIF`)
    }
    throw error
  }
}

/** 工具一：add_image_to_context（视觉模型可见）。 */
function registerAddImageTool(ctx: Context, store: FileAttachmentStore): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}
  return tools.register(defineTool({
    name: 'add_image_to_context',
    description: [
      'Add an uploaded image into the model context so the current vision-capable model can see it directly.',
      'The image becomes part of the conversation history (tool result with an image block).',
      'Only usable when the current model declares image input;',
      'once added, switching to a model without image input is rejected by the platform.',
    ].join(' '),
    parameters: {
      attachment_id: {
        type: 'string',
        required: true,
        description: 'attachment_id of the image file (from the uploaded-file list).',
      },
      description: {
        type: 'string',
        description: 'Optional 1-2 sentence caption that travels with the image into the context.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value: { name: string; image: ImageAttachmentRef }) => {
        // 图片块进上下文：工具结果 = image block（与官方 read_image 同构）。
        return [{
          type: 'image',
          attachment: value.image,
        }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const id = String(args.attachment_id).trim()
      if (id === '') throw new Error('attachment_id must be a non-empty string')
      const found = await requireImage(store, id)
      // 门控（防切换竞态）：当前模型必须声明 image 输入。
      const routed = exec.agent?.session.requestHeader()?.config
      const provider = routed?.provider ?? exec.agent?.options.provider
      const model = routed?.model ?? exec.agent?.options.model
      const llm = ctx.get('llm')
      if (provider !== undefined && model !== undefined && llm !== undefined) {
        const info = await llm.resolveModelInfo(provider, model, exec.signal)
        if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
          throw new Error(`current model "${model}" does not declare image input; use visual_assist instead, or switch to an image-capable model`)
        }
      }
      const { ref } = await saveImageRef(ctx, found)
      return {
        name: found.row.name,
        image: ref,
      }
    },
  }))
}

/** 工具二：visual_assist（无视觉模型可见）。 */
function registerVisualAssistTool(ctx: Context, store: FileAttachmentStore): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}
  return tools.register(defineTool({
    name: 'visual_assist',
    description: [
      'Send an uploaded image to the configured vision-assistant model (Settings → 视觉辅助)',
      'and return its text description. Use this when the current model cannot see images',
      'but the user needs image content understood.',
    ].join(' '),
    parameters: {
      attachment_id: {
        type: 'string',
        required: true,
        description: 'attachment_id of the image file (from the uploaded-file list).',
      },
      question: {
        type: 'string',
        description: 'Optional question about the image; defaults to a general description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value: { name: string; text: string }) => {
        return [{ type: 'text', text: `[视觉辅助 · ${value.name}]\n${value.text}` }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const id = String(args.attachment_id).trim()
      if (id === '') throw new Error('attachment_id must be a non-empty string')
      const found = await requireImage(store, id)
      const config = readVisionConfig()
      const provider = config.provider
      const model = config.model
      if (provider === undefined || provider === '' || model === undefined || model === '') {
        throw new Error('vision-assist model is not configured: open Settings → 视觉辅助 and pick a vision-capable provider/model')
      }
      const llm = ctx.get('llm')
      if (llm === undefined) throw new Error('llm service unavailable')
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        throw new Error(`vision-assist model "${model}" does not declare image input; pick an image-capable model in Settings → 视觉辅助`)
      }
      const question = String(args.question ?? '').trim()
      const { ref } = await saveImageRef(ctx, found)
      const blocks: ContentBlock[] = [{
        type: 'image',
        attachment: ref,
      }]
      const prompt = question === '' ? '描述这张图片的内容。' : question
      blocks.push({ type: 'text', text: prompt })
      const message: Message = {
        id: `vision-${Date.now()}` as Message['id'],
        role: 'user',
        content: blocks,
        source: { kind: 'plugin', plugin: 'dsh-file-fix', form: 'notice', summary: '📷 图片' },
      }
      let text = ''
      for await (const chunk of llm.stream({
        provider,
        model,
        messages: [message],
        signal: exec.signal,
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
      }
      if (text === '') throw new Error('vision-assist returned no text')
      return { name: found.row.name, text }
    },
  }))
}

/** 模态路由：监听 request/header → 按模型模态动态装卸两个工具。 */
export function installVisionRoute(ctx: Context, store: FileAttachmentStore): void {
  let addDisposer: (() => void) | undefined
  let assistDisposer: (() => void) | undefined
  let current: 'vision' | 'text' | undefined

  const applyFor = (provider: string, model: string): void => {
    const llm = ctx.get('llm')
    if (llm === undefined) return
    void llm.resolveModelInfo(provider, model).then(info => {
      const vision = info.inputModalities !== undefined && info.inputModalities.includes('image')
      if (current === (vision ? 'vision' : 'text')) return
      addDisposer?.()
      assistDisposer?.()
      if (vision) addDisposer = registerAddImageTool(ctx, store)
      else assistDisposer = registerVisualAssistTool(ctx, store)
      current = vision ? 'vision' : 'text'
      ctx.logger.info('[dsh-file-fix] vision route: %s -> %s tool(s)', model, vision ? 'add_image_to_context' : 'visual_assist')
    }).catch(() => { /* 模型路由未解析时保持现状 */ })
  }

  // 默认：未收到 request/header 前按无视觉模型处理（DeepSeek 官方模型均为纯文本）。
  assistDisposer = registerVisualAssistTool(ctx, store)
  current = 'text'

  ctx.root.on('session/event', (_session: unknown, event: { type?: string; data?: unknown }) => {
    if (event.type !== 'request/header') return
    const header = (event.data as { config?: { provider?: string; model?: string } } | undefined)?.config
    if (header?.provider !== undefined && header?.model !== undefined) {
      applyFor(header.provider, header.model)
    }
  })
}

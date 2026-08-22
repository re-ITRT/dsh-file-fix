/** 视觉上下文标记：判定「session 需要视觉」——任何直接图片注入（draft image 提交、
 * read_image / add_image_to_context 的结果）都会让 session 进入需要视觉状态。
 * visual_assist 返回纯文本，不标记。
 *
 * 判定依据（会话事件重放安全）：
 * - user/message 的 content 含 { type: 'image' } block（draft image 提交）
 * - tool/result 的 content 含 { type: 'image' } block（read_image / add_image_to_context）
 * 两种都是「直接图片注入」；visual_assist 的结果是纯文本 block，天然排除。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** 会话级联清理 / 重放恢复时使用的最小事件视图。 */
interface ContentBlockLike {
  type?: string
}

/** 判定一个消息的 content 数组是否含 image block。 */
function contentHasImage(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((block: unknown) => {
    if (typeof block !== 'object' || block === null) return false
    const b = block as ContentBlockLike
    return b.type === 'image'
  })
}

/** 从 user/message 或 tool/result 事件提取 content 并判定。 */
function eventCarriesImage(event: SessionEvent): boolean {
  if (typeof event.data !== 'object' || event.data === null) return false
  const data = event.data as unknown as { content?: unknown }
  if (event.type === 'user/message') return contentHasImage(data.content)
  if (event.type === 'tool/result') {
    // tool/result 的 message.content 是 [ToolResultBlock]，真正的内容在 block.content 里。
    const message = (event.data as unknown as { message?: { content?: ReadonlyArray<{ content?: unknown }> } }).message
    if (Array.isArray(message?.content)) {
      for (const block of message.content) {
        if (block?.content !== undefined && contentHasImage(block.content)) return true
      }
    }
  }
  return false
}

/** 当前已知的「需要视觉」session 集合（内存；重放时从事件重建）。 */
const needsVision = new Set<string>()

/** 查询一个 session 是否需要视觉。 */
export function sessionNeedsVision(sessionId: string): boolean {
  return needsVision.has(sessionId)
}

/** 记录一个 session 需要视觉（幂等）。 */
export function markSessionNeedsVision(sessionId: string): void {
  needsVision.add(sessionId)
}

/**
 * 从持久化日志重放一个 session 的视觉状态（session-start / 历史恢复时调用）。
 * 逐事件判定：任一直接图片注入即标记。
 */
export async function rebuildVisionState(
  ctx: Context,
  sessionId: SessionId,
): Promise<boolean> {
  const persistence = ctx.get('sessionPersistence') as
    | { inspect: (id: SessionId) => Promise<{ events: readonly SessionEvent[] }> }
    | undefined
  if (persistence === undefined) return false
  try {
    const { events } = await persistence.inspect(sessionId)
    const vision = events.some(eventCarriesImage)
    if (vision) needsVision.add(String(sessionId))
    return vision
  } catch {
    return false
  }
}

/** 安装视觉上下文监听：任何携带 image block 的 user/message 或 tool/result 都标记。 */
export function installVisionStateTracking(ctx: Context): void {
  const root = ctx.root
  root.on('session/event', (session: Session, event: SessionEvent) => {
    if (!eventCarriesImage(event)) return
    needsVision.add(String(session.id))
  })
}
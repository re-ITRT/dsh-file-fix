/** 会话桥：文件挂载事件 + pre-step 注入 sys 消息 + 恢复重建。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { debugLog } from './debug-log.ts'
import type { UploadService } from './remote.ts'
import type { FilesAttachedEventData, UploadedFile } from './types.ts'

/** 自定义会话事件类型（ignorable：跨版本重放安全，客户端节点定义负责渲染）。 */
export const FILES_ATTACHED_EVENT = 'uploadux/files'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'uploadux/files': FilesAttachedEventData
  }
}

function isUserSurfaceMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message'
    && typeof event.data === 'object'
    && event.data !== null
    && (event.data as { source?: { kind?: string } }).source?.kind === 'user'
}

function messageIdOf(event: SessionEvent<'user/message'>): string {
  const data = event.data as unknown as { id?: string }
  return data.id ?? ''
}

/** 给模型看的文件列表文本（sys 角色，用户界面不可见）。 */
export function fileListSystemText(files: readonly UploadedFile[]): string {
  const lines = files.map(file =>
    `- ${file.name} — attachment_id="${file.attachmentId}" size=${file.size} mediaType="${file.mediaType}"`,
  )
  return [
    '用户随本条消息上传了以下文件，已存入附件库（附件库独立于工作区）：',
    ...lines,
    '需要读取文件内容时，调用 read_attachment 工具（参数 attachment_id 取上面对应值）。',
  ].join('\n')
}

/** 构造注入用的 sys 消息（角色 system、来源插件）。 */
function systemMessage(text: string, id: string, files: UploadedFile[]): Message {
  return {
    id: `uploadux-${id}` as Message['id'],
    // 注意：存储校验要求批次内消息 role=user（system 会毒化日志导致历史不可用）。
    // 用 user 角色 + plugin 来源 + notice 表单：模型按普通注入消息读到完整列表，
    // UI 只显示一行摘要（点击才展开），附件文字信息默认隐藏。
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-upload-ux',
      form: 'notice',
      summary: `📎 附件 ${files.length} 个文件`,
    },
  }
}

/**
 * 安装附件桥：
 * 1. session/event 火线监听 user/message → 消费 pending → 追加 uploadux/files 事件
 * 2. agent/pre-step 瀑布 → 把文件列表作为 sys 消息插在携带文件的 user 消息之后
 * 3. agent/session-start → 从持久化日志重建 messageId→files 映射（恢复场景）
 */
export function installAttachmentBridge(ctx: Context, service: UploadService): void {
  const persistence = ctx.get('sessionPersistence') as SessionPersistence
  const attached = service.attached

  // 注册在 root：session/event 沿 emitCtx 祖先链派发，root 必在链上；
  // 插件自身的 fiber ctx 可能是兄弟子树，收不到（实测）。listener 仍归属本 fiber，随插件卸载。
  const root = ctx.root
  debugLog('bridge installing on ctx.root, root===ctx ->', String(root === ctx))

  const rebuildFor = async (sessionId: SessionId): Promise<void> => {
    try {
      const inspection = await persistence.inspect(sessionId)
      for (const event of inspection.events) {
        if (event.type !== FILES_ATTACHED_EVENT) continue
        const data = event.data as unknown as FilesAttachedEventData
        if (typeof data?.messageId === 'string' && Array.isArray(data.files)) {
          attached.set(data.messageId, { seq: event.seq, files: data.files as UploadedFile[] })
        }
      }
    } catch (error) {
      ctx.logger.warn('[dsh-upload-ux] rebuild attachments failed for %s: %o', String(sessionId), error)
    }
  }

  // 事件待落盘标记：pre-step 已注入的会话，等 user/message 落盘后补 uploadux/files 事件。
  const eventDue = new Set<string>()

  root.on('session/event', (session: Session, event: SessionEvent) => {
    debugLog('session/event type=', event.type)
    if (!isUserSurfaceMessage(event)) return
    debugLog('user surface message seen, session=', String(session.id))
    const sessionId = String(session.id)
    const messageId = messageIdOf(event)
    const entry = attached.get(messageId)
    if (entry !== undefined && eventDue.has(sessionId)) {
      eventDue.delete(sessionId)
      entry.seq = event.seq
      const data: FilesAttachedEventData = { messageId, files: entry.files }
      // 监听器运行在 user/message 的 append 发布边界内：直接 append 会撞 reentrancy
      // 守卫；且 store 级 append 要求 seq 严格衔接已存日志 cursor。agent 会继续追加
      // 事件抢占 seq，所以带重试：等 drain 追平后按当前 live seq 落盘。
      queueMicrotask(() => {
        void appendWithRetry(session, data, messageId)
      })
    }
  })

  /** 重试落盘：seq 与 drain cursor 存在竞态，等追平后按当前 live seq 写入。 */
  async function appendWithRetry(
    session: Session,
    data: FilesAttachedEventData,
    messageId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        await persistence.append(session.id, [{
          type: FILES_ATTACHED_EVENT,
          seq: session.seq,
          time: Date.now(),
          data,
          ignorable: true,
        } as SessionEvent])
        debugLog('files event appended ok (attempt', String(attempt) + ')', 'messageId=', messageId)
        return
      } catch (error) {
        if (attempt === 149) {
          debugLog('append files event FAILED after retries:', String(error))
          return
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const sessionId = String(agent.id)
    const pending = service.takePending(sessionId)
    const byMessage = decision.messages
      .map((message, index) => ({ message, index }))
      .filter(entry => attached.has(String(entry.message.id)))
    if (pending.length === 0 && byMessage.length === 0) return decision
    // 首次注入：pending（pre-step 先于 user/message 落盘执行，attached 尚空）；
    // 重试/后续 step：attached（由监听器在上一次 user/message 落盘时记录）。
    const lastIndex = Math.max(
      byMessage.length > 0 ? byMessage[byMessage.length - 1]!.index : 0,
      decision.messages.length - 1,
    )
    const files = [...pending, ...byMessage.flatMap(entry => attached.get(String(entry.message.id))?.files ?? [])]
    const anchor = decision.messages[lastIndex]
    if (anchor === undefined || files.length === 0) return decision
    if (pending.length > 0) {
      // 转存：监听器在 user/message 落盘时按 messageId 取用、补 seq 并追加事件。
      attached.set(String(anchor.id), { seq: -1, files: pending })
      eventDue.add(sessionId)
    }
    const sys = systemMessage(fileListSystemText(files), String(anchor.id), files)
    const entered = decision.messages.toSpliced(lastIndex + 1, 0, sys as UserMessage)
    debugLog('pre-step injected file list session=', sessionId, 'files=', files.length)
    return { kind: 'enter', messages: entered }
  })

  ctx.on('agent/session-start', ({ agent }) => {
    void rebuildFor(agent.id)
  })
}

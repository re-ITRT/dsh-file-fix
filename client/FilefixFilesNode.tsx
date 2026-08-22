/** 附件文件列表 Conversation Node：官方架构的 business node（kind `filefix-files`）。
 * - 数据源：`filefix/files` 会话事件（自带 messageId，可重放）。
 * - 官方引擎把事件 fold 成 State，ChatNodeSeat 按 kind 路由到本 renderer；
 *   不再 shadow 官方 user/steering 节点，翻页/重放/依赖交给 conversationEvents 引擎。
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  ConversationNodeDefinition,
  ConversationNodeContext,
  ConversationMatch,
  ChatConversationViewNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FilesAttachedEventData, UploadedFile } from '../src/types.ts'
import { FileListBubble } from './FileListBubble.tsx'
import type { UploadRemote } from './remote.ts'

/** 声明合并：本业务 kind 的托管 data 类型。 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'filefix-files': FilefixFilesChatData
  }
}

/** 参与渲染的最终 data（renderer 只读）。 */
export interface FilefixFilesChatData {
  readonly files: readonly (UploadedFile & { available?: boolean })[]
  readonly seq: number
  readonly messageId: string
}

/** State：引擎持有，`start` 构建。 */
interface FilefixFilesState {
  readonly files: readonly UploadedFile[]
  readonly seq: number
  readonly messageId: string
}

function isFilesEvent(event: { type?: string; data?: unknown }): event is { type: 'filefix/files'; data: FilesAttachedEventData } {
  return event.type === 'filefix/files'
}

/** 事件 → (kind-local id, lifecycle)。messageId 即业务 id。 */
function match(event: { type?: string; data?: unknown }): { id: string; role: 'start' | 'update' } | null {
  if (!isFilesEvent(event)) return null
  const id = String(event.data.messageId)
  if (id === '') return null
  return { id, role: 'start' }
}

function start(context: ConversationNodeContext<FilefixFilesState>, match: ConversationMatch): FilefixFilesState {
  const event = match.event as unknown as { type: 'filefix/files'; data: FilesAttachedEventData; seq?: number }
  return {
    files: event.data.files,
    seq: event.seq ?? context.start?.event.seq ?? 0,
    messageId: event.data.messageId,
  }
}

/** 单事件业务：无更新，保持现有 State。 */
function update(context: ConversationNodeContext<FilefixFilesState> & { readonly state: FilefixFilesState }): FilefixFilesState {
  return context.state
}

function buildViewNode(context: ConversationNodeContext<FilefixFilesState>): ChatConversationViewNode | null {
  if (context.state === undefined) return null
  return {
    key: context.key,
    kind: 'filefix-files',
    id: context.id,
    target: 'chat',
    anchorSeq: context.start?.event.seq ?? 0,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      files: context.state.files,
      seq: context.state.seq,
      messageId: context.state.messageId,
    },
  }
}

export const filefixFilesDefinition: ConversationNodeDefinition<FilefixFilesState> = {
  kind: 'filefix-files',
  target: 'chat',
  match,
  start,
  update,
  buildViewNode,
}

let remote: UploadRemote | undefined

/** apply 时设置（keyed 注册无 inject 通道）。 */
export function setFilefixNodeUpload(value: UploadRemote | undefined): void {
  remote = value
}

/** 字节可用性（下载按钮置灰依据）——渲染时经 remote checkAvailable 查询一次。 */
type FileWithAvailable = UploadedFile & { available?: boolean }

export function FilefixFilesNodeView({ node }: ChatNodeViewProps<'filefix-files'>): ReactElement | null {
  // 显式标注：published 类型的 mapped-type 交叉在 bundler 解析下 .map 回调
  // 推断退化（TS 对 `ChatConversationViewNode & { data }` 交叉的已知行为）。
  const files: readonly FileWithAvailable[] = node.data.files
  const [availability, setAvailability] = useState<Map<string, boolean> | null>(null)

  useEffect(() => {
    if (remote === undefined) return
    let cancelled = false
    void (async () => {
      const ids = files.map(file => file.attachmentId)
      const result = await remote.checkAvailable({ attachmentIds: ids }).catch(() => ({ ok: false as const }))
      if (cancelled || !result.ok) return
      setAvailability(new Map(Object.entries(result.value.available)))
    })()
    return () => { cancelled = true }
  }, [files])

  const withAvailable: FileWithAvailable[] = files.map(file => ({
    ...file,
    available: availability === null ? file.available : (availability.get(file.attachmentId) ?? false),
  }))

  return (
    <FileListBubble node={{ data: { messageSeq: node.data.seq, messageId: node.data.messageId, files: withAvailable } }} />
  )
}

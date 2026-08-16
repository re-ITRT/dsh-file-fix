/** 用户消息节点包装：极简用户气泡（右对齐）+ 本插件文件气泡（按消息 seq 关联）。
 * 不深导入官方内部组件（external 拦截 + css 模块样式会失效）。 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { UploadedFile } from '../src/types.ts'
import type { UploadRemote } from './remote.ts'
import { FileListBubble } from './FileListBubble.tsx'
import * as s from './styles.ts'

let remote: UploadRemote | undefined

/** apply 时设置（keyed 注册无 inject 通道）。 */
export function setUserNodeUpload(value: UploadRemote | undefined): void {
  remote = value
}

interface UserNodeData {
  kind?: string
  seq?: number
  time?: number
  content?: ReadonlyArray<{ type?: string; text?: string }>
  source?: { kind?: string }
}

export function UserNodeWithFiles(props: unknown): ReactElement | null {
  const { node, sessionId } = props as {
    node?: { data?: UserNodeData }
    sessionId?: string
  }
  const data = node?.data
  const [associations, setAssociations] = useState<Map<number, UploadedFile[]>>(new Map())

  useEffect(() => {
    if (remote === undefined || sessionId === undefined) return
    let cancelled = false
    void remote.listFiles({ sessionId }).then(result => {
      if (cancelled || !result.ok) return
      const map = new Map<number, UploadedFile[]>()
      for (const entry of result.value.items) map.set(entry.seq, entry.files)
      setAssociations(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId])

  const seq = data?.seq
  const files = seq !== undefined ? associations.get(seq) : undefined

  const text = (data?.content ?? [])
    .map(block => block.text ?? '')
    .join('\n')

  return (
    <div style={s.userBubbleWrap}>
      <div style={s.userBubble}>
        <div style={s.userBubbleText}>{text}</div>
        {data?.time !== undefined && (
          <div style={s.userBubbleTime}>
            {new Date(data.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
      {files !== undefined && files.length > 0 && (
        <FileListBubble node={{ data: { messageSeq: seq ?? 0, messageId: '', files } }} />
      )}
    </div>
  )
}

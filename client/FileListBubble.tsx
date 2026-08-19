/** 历史消息里附着于文字气泡下方的文件列表气泡：显示名 + 大小 + 点击下载。 */

import type { UploadedFile } from '../src/types.ts'
import * as s from './styles.ts'

interface FilesNode {
  data: {
    messageSeq: number
    messageId: string
    files: (UploadedFile & { available?: boolean })[]
  }
}

export interface FileListBubbleProps {
  node: FilesNode
}

export function downloadUrl(attachmentId: string): string {
  return `/plugins/dsh-file-fix/download/${attachmentId}`
}

/** 历史消息下方：文件列表（附件机制，工作区无关）。字节被清理后下载按钮消失（记录保留）。 */
export function FileListBubble({ node }: FileListBubbleProps): React.ReactElement {
  const { files } = node.data
  return (
    <div style={s.bubble} aria-label="附件文件列表">
      <div style={s.bubbleTitle}>📎 {files.length} 个附件文件</div>
      {files.map(file => {
        const available = file.available !== false
        return (
          <div key={file.attachmentId} style={s.fileRow}>
            <span style={s.fileName}>{file.name}</span>
            <span style={s.fileMeta}>{formatSize(file.size)}</span>
            {available ? (
              <a style={s.downloadLink} href={downloadUrl(file.attachmentId)} title={`下载 ${file.name}`}>
                <span style={s.downloadMark}>⬇</span>
              </a>
            ) : (
              <span style={s.downloadGone} title="附件字节已清理，仅保留记录">已清理</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

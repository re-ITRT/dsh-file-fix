/** 整页 drop / 粘贴的文件拦截层：document 捕获阶段，照 Hermes 的交互细节。 */

export interface InterceptHandlers {
  /** 拦截到文件时回调（原始 File 列表）。 */
  onFiles: (files: File[]) => void
  /** 是否有会话可接收（无会话时不拦截）。 */
  canAccept: () => boolean
}

interface InterceptState {
  depth: number
  aborted: boolean
}

/**
 * 安装 document 级捕获监听：
 * - dragenter/over/leave/drop：深度计数防闪烁、视口边界强制复位、Esc 取消、
 *   处理后派发合成 dragend（复位任何残留的拖拽 UI）。
 * - paste：剪贴板带文件时完全接管（纯文本粘贴不受影响）。
 * 捕获阶段 + stopPropagation 确保官方 InputBar 的 document 冒泡监听收不到文件拖拽。
 */
export function installFileIntercept(handlers: InterceptHandlers): () => void {
  const state: InterceptState = { depth: 0, aborted: false }

  const hasFiles = (transfer: DataTransfer | null): boolean =>
    transfer !== null && Array.from(transfer.types).includes('Files')

  const reset = (): void => {
    state.depth = 0
    state.aborted = false
  }

  const onDragEnter = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer) || !handlers.canAccept()) return
    event.preventDefault()
    event.stopPropagation()
    state.aborted = false
    state.depth += 1
  }

  const onDragOver = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer) || !handlers.canAccept()) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    state.depth = Math.max(0, state.depth - 1)
    if (state.depth === 0) {
      state.aborted = false
      return
    }
    // 离开视口边界说明拖拽离开了窗口，强制复位。
    const leavingViewport = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
    if (leavingViewport) reset()
  }

  const onDrop = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    const aborted = state.aborted
    reset()
    if (aborted || !handlers.canAccept()) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) {
      handlers.onFiles(files)
      // 官方 InputBar 在 window 上监听 dragend 复位 overlay —— 合成派发兜底。
      try {
        window.dispatchEvent(new DragEvent('dragend'))
      } catch {
        /* 旧引擎不支持 DragEvent 构造：忽略 */
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (state.depth === 0) return
    event.preventDefault()
    event.stopPropagation()
    state.aborted = true
    reset()
  }

  const onPaste = (event: ClipboardEvent): void => {
    if (!handlers.canAccept()) return
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    handlers.onFiles(files)
  }

  document.addEventListener('dragenter', onDragEnter, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)
  document.addEventListener('paste', onPaste, true)
  window.addEventListener('keydown', onKeyDown, true)

  return () => {
    document.removeEventListener('dragenter', onDragEnter, true)
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('dragleave', onDragLeave, true)
    document.removeEventListener('drop', onDrop, true)
    document.removeEventListener('paste', onPaste, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}

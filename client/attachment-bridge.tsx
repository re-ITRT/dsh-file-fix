/** 附件桥：从 conversation.input.attachments owner 传递官方图片注入能力到两层 UI。
 * 该组件注册在 attachments slot（渲染 null），仅把 owner（onAddImages/canAcceptDrop/
 * attachments/onRemoveImage）存到模块级，供 dock 里的 TwoLayerRail 读取。
 */

import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 模块级桥状态。 */
interface AttachmentBridgeState {
  attachments: readonly ComposerAttachment[]
  canAcceptDrop: boolean
  onAddImages: (files: readonly File[]) => void
  onRemoveImage: (id: ComposerAttachment['id']) => void
}
let bridgeState: AttachmentBridgeState | null = null
const bridgeListeners = new Set<() => void>()

export function setAttachmentBridge(state: AttachmentBridgeState): void {
  bridgeState = state
  for (const fn of [...bridgeListeners]) fn()
}

export function getAttachmentBridge(): AttachmentBridgeState | null {
  return bridgeState
}

export function subscribeAttachmentBridge(fn: () => void): () => void {
  bridgeListeners.add(fn)
  return () => { bridgeListeners.delete(fn) }
}

/** attachments slot 的隐形组件：仅传递 owner。 */
export function AttachmentsBridge(props: ComposerAttachmentsOwnerProps): null {
  setAttachmentBridge({
    attachments: props.attachments,
    canAcceptDrop: props.canAcceptDrop,
    onAddImages: props.onAddImages,
    onRemoveImage: props.onRemoveImage,
  })
  return null
}
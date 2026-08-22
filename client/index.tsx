/** dsh-file-fix 浏览器半：Remote 挂载、拦截、两层 rail + 选择按钮、模型选择（视觉置灰）、历史文件气泡节点。 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactElement } from 'react'
// 类型合并：slot 键 + ChatNodeDataMap 扩展。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UploadLimits } from '../src/types.ts'
import { UPLOAD_TYPERT_REMOTE, type UploadRemote } from './remote.ts'
import { UploadPickerButton, setPickerShare } from './UploadPickerButton.tsx'
import { TwoLayerRail, setTwoLayerShare } from './TwoLayerRail.tsx'
import { ModelSelectWithVision, setModelNeedsVision, setModelSelectService, setModelVisionSupport } from './ModelSelectWithVision.tsx'
import { ensureUploadStoreInstance, getUploadStoreActions } from './upload-store.ts'
import { installTwoLayerController, setTwoLayerController } from './two-layer-controller.ts'
import { markLocalSessionNeedsVision } from './vision-context.ts'
import { installVisionNavIcon } from './nav-icon.ts'
import { installToolbarLayout } from './toolbar-layout.ts'
import { VisionSettingsSection, setVisionUpload } from './VisionSettingsSection.tsx'
import { RetentionSettingsSection, setRetentionUpload } from './RetentionSettingsSection.tsx'
import { filefixFilesDefinition, FilefixFilesNodeView, setFilefixNodeUpload } from './FilefixFilesNode.tsx'

export const name = 'dsh-file-fix'

export const inject = ['slots', 'remote', 'conversationEvents', 'modelDirectories']

export async function apply(ctx: ClientContext): Promise<void> {
  // 上传工具面：预检 + 字节上传 + 挂载，注入注入面（rail/picker/history 共享）。
  await ctx.remote.$mount(UPLOAD_TYPERT_REMOTE)
  // 命名空间服务由 $mount 注册为 remote.filefix —— 用 ctx.get 读取。
  const upload = ctx.get('remote.filefix') as UploadRemote
  const modelDirectories = ctx.get('modelDirectories') as
    | { directoryFor: (sessionId: string) => import('./ModelSelectWithVision.tsx').ModelDirectoryLike }
    | undefined

  // 限制：启动时拉一次，失败保持 null（预检跳过，由 host 端拒绝兜底）。
  const limitsBox: { value: UploadLimits | null } = { value: null }
  void upload.limits().then(result => {
    if (result.ok) {
      limitsBox.value = result.value
      ctx.logger.info(
        '[dsh-file-fix] limits loaded: %d bytes/file, %d files/batch, %d bytes/batch',
        result.value.maxFileBytes, result.value.maxFilesPerBatch, result.value.maxBatchBytes,
      )
    } else {
      ctx.logger.warn('[dsh-file-fix] limits unavailable: %o', result.error)
    }
  }).catch(error => {
    ctx.logger.warn('[dsh-file-fix] limits fetch failed: %o', error)
  })

  // 模块级上传 store（两层 UI + 📎 按钮共享）。
  ensureUploadStoreInstance()
  setPickerShare({ upload, getLimits: () => limitsBox.value, logger: ctx.logger })
  setTwoLayerShare({ upload, getLimits: () => limitsBox.value, logger: ctx.logger })

  // 安装 document 级拖拽/粘贴拦截（始终生效，独立于 slot 渲染）。
  setTwoLayerController({
    upload,
    getLimits: () => limitsBox.value,
    logger: ctx.logger,
    getSessionId: () => undefined,
    onAddImages: () => {},
    canAcceptDrop: () => true,
    markVision: (sessionId: string) => { markLocalSessionNeedsVision(sessionId) },
  })
  installTwoLayerController()
  if (modelDirectories !== undefined) {
    setModelSelectService({
      directoryFor: (sessionId: string) => modelDirectories.directoryFor(sessionId) as import('./ModelSelectWithVision.tsx').ModelDirectoryLike,
      upload,
    })
  }

  // 历史文件气泡节点：官方 Conversation Node 范式。
  // 用 conversationEvents 注册 business Definition（引擎 fold filefix/files 事件成
  // State 并负责重放/翻页），再按 kind 'filefix-files' 注册专属 renderer——
  // 不 shadow 官方 user/steering 节点，与官方节点互相独立。
  setFilefixNodeUpload(upload)
  setVisionUpload(upload)
  setRetentionUpload(upload)

  // 模型视觉能力表（供模型切换置灰）。
  void upload.listModelVisionSupport().then(result => {
    if (!result.ok) return
    const map = new Map<string, boolean>()
    for (const provider of result.value.providers) {
      for (const model of provider.models) map.set(provider.provider + '/' + model.id, model.image)
    }
    setModelVisionSupport(upload, map, null)
  }).catch(() => {})

  ctx.conversationEvents.register(filefixFilesDefinition)
  ctx.slots.inject('conversation.chat.node', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'filefix-files',
    }, FilefixFilesNodeView as unknown as (props: unknown) => ReactElement | null)

    return () => { dispose() }
  })

  // 两层横向拖放 rail：接管官方 conversation.input.attachments（priority -1 shadow 官方
  // ComposerAttachments）——图像层走官方注入链路，文件层走插件链路。
  ctx.slots.inject('conversation.input.attachments', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.attachments',
      priority: -1,
    }, TwoLayerRail as unknown as (props: unknown) => ReactElement | null)
    return () => { dispose() }
  })

  // 📎 选择按钮：任意类型文件走插件文件层（两层 UI 的快捷入口）。
  ctx.slots.inject('conversation.input.left', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.left',
      id: 'upload-picker',
      order: 0,
    }, UploadPickerButton)
    return () => { dispose() }
  })

  // 模型选择（视觉置灰）：接管官方 conversation.input.model（priority -1 shadow 官方
  // ModelSelect）——当前 session 需要视觉时，无视觉模型置灰不可选。
  ctx.slots.inject('conversation.input.model', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.model',
      priority: -1,
    }, ModelSelectWithVision as unknown as (props: unknown) => ReactElement | null)
    return () => { dispose() }
  })

  // 设置 → 视觉辅助 section：配置 visual_assist 的辅助模型。
  ctx.slots.inject('settings.section', () => {
    const dispose = ctx.slots.register({
      name: 'settings.section',
      id: 'filefix-vision',
      order: 120,
      label: '视觉辅助',
    }, VisionSettingsSection)
    return () => { dispose() }
  })

  // 设置 → 附件清理 section：GC 阈值 + 手动清理。
  ctx.slots.inject('settings.section', () => {
    const dispose = ctx.slots.register({
      name: 'settings.section',
      id: 'filefix-retention',
      order: 121,
      label: '附件清理',
    }, RetentionSettingsSection)
    return () => { dispose() }
  })

  // 视觉辅助设置导航图标补丁（外壳 navIcon 无扩展点 → MutationObserver + CSS mask）。
  installVisionNavIcon()
  // 输入工具栏布局：加号与文件图标相邻、权限右推（CSS order + margin-left:auto）。
  installToolbarLayout()

  ctx.logger.info('[dsh-file-fix] client loaded: two-layer rail + picker + model vision gating + file bubbles + vision settings')
}
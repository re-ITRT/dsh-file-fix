/** dsh-file-fix 浏览器半：Remote 挂载、拦截、rail + 选择按钮、历史文件气泡节点。 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactElement } from 'react'
// 类型合并：slot 键 + ChatNodeDataMap 扩展。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UploadLimits } from '../src/types.ts'
import { UPLOAD_TYPERT_REMOTE, type UploadRemote } from './remote.ts'
import { createUploadStore } from './store.ts'
import { UploadPickerButton } from './UploadPickerButton.tsx'
import { UploadRail } from './UploadRail.tsx'
import { UserNodeWithFiles, setUserNodeUpload } from './UserNodeWithFiles.tsx'
import { installVisionNavIcon } from './nav-icon.ts'
import { installToolbarLayout } from './toolbar-layout.ts'
import { VisionSettingsSection, setVisionUpload } from './VisionSettingsSection.tsx'

export const name = 'dsh-file-fix'

export const inject = ['slots', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  // 上传工具面：预检 + 字节上传 + 挂载，注入注入面（rail/picker/history 共享）。
  await ctx.remote.$mount(UPLOAD_TYPERT_REMOTE)
  // 命名空间服务由 $mount 注册为 remote.filefix —— 用 ctx.get 读取。
  const upload = ctx.get('remote.filefix') as UploadRemote

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

  // rail + picker 共享同一个 store handle（同 scope 同一实例）与 inject 面。
  const store = createUploadStore()
  const share = {
    upload,
    getLimits: () => limitsBox.value,
    logger: ctx.logger,
  }

  // 历史气泡：shadow 官方 user/steering 节点渲染器（priority -1 胜出），包装官方组件 + 文件列表。
  // keyed 注册不支持 inject —— upload 经模块级引用传给包装组件。
  setUserNodeUpload(upload)
  setVisionUpload(upload)
  ctx.slots.inject('conversation.chat.node', () => {
    const disposeUser = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'user',
      priority: -1,
    }, UserNodeWithFiles as unknown as (props: unknown) => ReactElement | null)
    const disposeSteering = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'steering',
      priority: -1,
    }, UserNodeWithFiles as unknown as (props: unknown) => ReactElement | null)
    return () => { disposeUser(); disposeSteering() }
  })

  ctx.slots.inject('conversation.input.dock', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'upload-rail',
      order: 1,
      store,
      inject: () => share,
    }, UploadRail)
    return () => { dispose() }
  })

  ctx.slots.inject('conversation.input.left', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.left',
      id: 'upload-picker',
      order: 0,
      store,
      inject: () => share,
    }, UploadPickerButton)
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

      // 视觉辅助设置导航图标补丁（外壳 navIcon 无扩展点 → MutationObserver + CSS mask）。
      installVisionNavIcon()
      // 输入工具栏布局：加号与文件图标相邻、权限右推（CSS order + margin-left:auto）。
      installToolbarLayout()

  ctx.logger.info('[dsh-file-fix] client loaded: intercept + rail + picker + file bubbles + vision settings')
}

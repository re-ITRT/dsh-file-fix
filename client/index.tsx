/** dsh-upload-ux 浏览器半：挂载 uploadux Remote、拦截 drop/paste、注册 rail + 选择按钮。 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型合并：conversation.input.dock / conversation.input.left 两个 slot 键。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UploadLimits } from '../src/types.ts'
import { UPLOAD_TYPERT_REMOTE, type UploadRemote } from './remote.ts'
import { createUploadStore } from './store.ts'
import { UploadPickerButton } from './UploadPickerButton.tsx'
import { UploadRail } from './UploadRail.tsx'

export const name = 'dsh-upload-ux'

/** 依赖：slot 注册表 + 客户端 Remote 网关。 */
export const inject = ['slots', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount(UPLOAD_TYPERT_REMOTE)
  // 命名空间服务由 $mount 注册为 remote.uploadux —— 用 ctx.get 读取
  // （属性代理只允许注入声明的服务，这里是自己挂载的动态服务）。
  const upload = ctx.get('remote.uploadux') as UploadRemote

  // 限制：启动时拉一次，失败时保持 null（预检跳过，由 host 端拒绝兜底）。
  const limitsBox: { value: UploadLimits | null } = { value: null }
  void upload.limits().then(result => {
    if (result.ok) {
      limitsBox.value = result.value
      ctx.logger.info(
        '[dsh-upload-ux] limits loaded: maxFileBytes=%d maxFilesPerBatch=%d maxBatchBytes=%d',
        result.value.maxFileBytes, result.value.maxFilesPerBatch, result.value.maxBatchBytes,
      )
    } else {
      ctx.logger.warn('[dsh-upload-ux] limits unavailable: %o', result.error)
    }
  }).catch(error => {
    ctx.logger.warn('[dsh-upload-ux] limits fetch failed: %o', error)
  })

  // 两个注册共享同一个 store handle（同 scope 同一实例），共享 inject 面。
  const store = createUploadStore()
  const share = {
    upload,
    getLimits: () => limitsBox.value,
    logger: ctx.logger,
  }

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

  ctx.logger.info('[dsh-upload-ux] client loaded: intercept + rail + picker registered')
}

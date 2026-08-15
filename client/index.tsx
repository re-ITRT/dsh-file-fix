/**
 * dsh-upload-ux 的浏览器半。
 *
 * TODO(实现阶段，思路已验证于 dsh-vision-tool 的 installFileDrop)：
 *  - 非图片文件 drop / 粘贴（Ctrl+V）→ 落盘会话工作区 attachments/ + 引用文本注入输入框
 *  - 修复 DSH 原生「拖入图片」drag overlay 卡住（处理后派发合成 dragend 复位）
 *  - 压掉纯非图片 drop 的「仅支持 PNG、JPG、WebP、GIF」误提示
 *  - 可选：点击选择文件、上传进度、大小限制、文件列表
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'dsh-upload-ux'

export function apply(ctx: ClientContext) {
  ctx.logger.info('[dsh-upload-ux] client loaded')
}

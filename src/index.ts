import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-upload-ux'

/**
 * 依赖的服务：全部就绪后 apply 才会执行（Cordis 注入）。
 * 上传体验的主体在浏览器侧（client/）；host 侧按需提供
 * 文件落盘 / Typert Remote 等服务（实现阶段补充）。
 */
export const inject: string[] = []

export function apply(ctx: Context) {
  ctx.logger.info('[dsh-upload-ux] host side loaded')
}

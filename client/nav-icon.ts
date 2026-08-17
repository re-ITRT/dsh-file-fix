/**
 * 设置导航图标补丁。
 *
 * dsh 外壳的 settings navIcon 是硬编码映射（models/agent-presets/plugins 专属，
 * 其余默认齿轮），第三方 section 无官方扩展点（SettingsSectionRow 只有
 * id/order/label）。参考社区 skill-mcp-panel 的成熟做法：
 *  1. MutationObserver 扫描设置面板 dialog 的按钮，按内文匹配「视觉辅助」→
 *     打 data-filefix-vision-nav 标记；
 *  2. 注入 CSS：隐藏官方 SVG（svg{display:none}）+ ::before 用 CSS mask
 *     绘制自定义线性图标（currentColor 着色，与官方图标同色同风格）。
 */

/** 线性放大镜图标（24×24 单色 PNG，CSS mask 用 alpha）。 */
const VISION_NAV_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAgUlEQVR4nNWV2w7AIAhDqf//z11M9jLiuOmW0FdJD0aoIt0F65AkH8UAjgC0sVYGBMtcG1lnIU0Dr/tM3dSQv8REV5n6z28w2gP6TxF2Fo0kvYUrRwWDW10KOy4aeIPk8+RWFFJ+ZCzMVtCtKUIAsj2mcCBH9gAKUvorJKBMGvfRBZ9Hb+4r321WAAAAAElFTkSuQmCC'

const VISION_LABELS = ['视觉辅助']

const cssIcon = `button[data-filefix-vision-nav]>svg{display:none!important}button[data-filefix-vision-nav] svg{display:none!important}button[data-filefix-vision-nav] *::before{display:none!important}button[data-filefix-vision-nav] *::after{display:none!important}button[data-filefix-vision-nav] *{background-image:none!important}button[data-filefix-vision-nav]::before{content:"";width:16px;height:16px;flex:none;display:inline-block;background-color:currentColor;-webkit-mask:url(data:image/png;base64,B64) center/16px 16px no-repeat;mask:url(data:image/png;base64,B64) center/16px 16px no-repeat}`.replaceAll('B64', VISION_NAV_BASE64)

/** 安装视觉辅助导航图标补丁（幂等；client apply 时调用）。 */
export function installVisionNavIcon(): void {
  if (typeof document === 'undefined') return

  const style = document.createElement('style')
  style.dataset.filefixNav = '1'
  style.textContent = cssIcon
  ;(document.head ?? document.documentElement).appendChild(style)

  let scheduled = false
  const patch = (): void => {
    scheduled = false
    if (typeof document === 'undefined') return
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      for (const button of dialog.querySelectorAll('button')) {
        if (button.dataset.filefixVisionNav !== '1') {
          let hit = false
          for (const span of button.querySelectorAll('span')) {
            const text = (span.textContent ?? '').trim()
            if (span.childElementCount === 0 && VISION_LABELS.includes(text)) {
              hit = true
              break
            }
          }
          if (hit) button.dataset.filefixVisionNav = '1'
        }
      }
    }
  }
  const schedule = (): void => {
    if (scheduled || typeof document === 'undefined') return
    scheduled = true
    queueMicrotask(patch)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()
}

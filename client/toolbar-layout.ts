/**
 * 输入工具栏布局补丁。
 *
 * 官方 InputBar 的 tools 区固定渲染为 `+号 → 权限(modes) → leftItems(rail)`，
 * 权限夹在加号和上传按钮中间。用户偏好「加号与文件符号相邻、权限推最右」。
 * 官方布局不可配，这里借鉴 nav-icon 的 DOM 打标 + CSS 注入做法：
 *  1. MutationObserver 定位 tools 容器与权限 modes 容器（按「Workspace Write」
 *     权限按钮的祖先链）→ 打 data 标记；
 *  2. 注入 CSS：rail order 提到权限前，modes 用 order+margin-left:auto 右推。
 */

let styleElt: HTMLStyleElement | null = null

const layoutCss = `
[data-filefix-tools] { display: flex; align-items: center; min-width: 0; flex: 1; }
[data-filefix-tools] > [data-slot] { order: 2; }
[data-filefix-tools] > [data-filefix-access-modes] { order: 3; margin-left: auto; }
`

/** 安装工具条布局补丁（幂等；client apply 时调用）。 */
export function installToolbarLayout(): void {
  if (typeof document === 'undefined') return

  if (styleElt === null) {
    styleElt = document.createElement('style')
    styleElt.dataset.filefixLayout = '1'
    styleElt.textContent = layoutCss
    ;(document.head ?? document.documentElement).appendChild(styleElt)
  }

  let scheduled = false
  const patch = (): void => {
    scheduled = false
    if (typeof document === 'undefined') return
    // 直接扫 tools 容器（工具栏左区：+号 + modes 权限 + leftItems）。
    // 不依赖权限按钮文案（不同权限模式显示 Workspace Write / Full access / Read-only…）：
    // 以 [class*="modes"] 子容器为准打标。
    for (const tools of document.querySelectorAll('[class*="tools"]')) {
      if (tools.hasAttribute('data-filefix-tools')) continue
      const modes = tools.querySelector('[class*="modes"]')
      if (modes === null) continue
      tools.setAttribute('data-filefix-tools', '1')
      modes.setAttribute('data-filefix-access-modes', '1')
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

/**
 * 渲染层入口。
 *
 * 只做三件事：挂样式、起 React、把启动编排交给 App。
 * 启动顺序（设置 → 会话 → 预载）刻意放在 App 的 effect 里，而不是这里 ——
 * 那边能拿到 StrictMode 之外的一次性 ref，也方便在卸载时统一回收订阅。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 不存在：index.html 被改坏了')

/* 阻止把文件拖进窗口时整个页面被替换成文件预览 —— 桌面应用里这是纯粹的破坏，
   而我们的「拖到歌单」是组件级 dragover 处理的，不需要浏览器兜底行为。 */
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

/* 右键菜单统一由自绘的 ContextMenuHost 接管；这里的 preventDefault 只是掐掉
   Chromium 自带的那个（含「重新加载 / 检查元素」），组件里需要时再自行 openMenuFromEvent。 */
window.addEventListener('contextmenu', (event) => {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea')) return
  event.preventDefault()
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)

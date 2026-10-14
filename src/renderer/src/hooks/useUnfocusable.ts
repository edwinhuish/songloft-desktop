/**
 * 让一棵子树**彻底无法获得焦点**（迷你窗用，见 components/MiniPlayer.tsx）。
 *
 * 为什么要有这么个东西：迷你条是**浮在别的应用旁边的挂件**，用户在上面点一下（静音、切歌、
 * 拖音量）只是想操作播放，不该让键盘焦点跑到它身上 —— 焦点一过去，主窗口那边的输入、快捷键
 * 语境就断了，而且挂件上出现一圈焦点环也莫名其妙。于是这里把「可聚焦性」整条路堵掉。
 *
 * ★ 做成 hooks/ 里的一个钩子而不是往每个按钮上写属性：迷你条里那些按钮有十几处，其中一半
 *   来自共享组件（队列面板、Slider），挨个改既漏又散。
 *
 * 四条路一起堵（少一条都能被绕过去）：
 *   ① **Tab 顺序**：子树里所有可聚焦元素写 `tabindex="-1"`（按钮、链接、输入控件、[tabindex]、
 *      contenteditable 都算）。这是静态那一半。
 *   ② **动态插入的**：队列滚出新行、歌词换页、菜单开合都会往这棵树里塞新元素，用
 *      MutationObserver 盯着；同时盯 `tabindex` 属性本身 —— React 重渲染时会把 Slider 那份
 *      `tabIndex` 再写回来（那是它作为 prop 声明的），不盯属性就会被覆盖回去。
 *   ③ **鼠标按下**：`mousedown` 在捕获阶段 `preventDefault()` ——「按下即聚焦」是它的默认行为，
 *      掐掉之后连那一瞬都不会聚焦。**点击本身不受影响**（`click` 照旧触发，实测音量的拖动也
 *      照旧：Slider 走的是 `pointerdown` + `setPointerCapture`，与这条默认行为无关）。
 *   ④ **程序化**：`el.focus()` 拦不住，但 `focusin` 一定冒泡到根上 —— 一旦发现焦点落在子树里
 *      就当场 `blur()`：结果同样是「没有焦点」，也不留视觉反馈。
 *      ③ 是「不让它聚焦」，④ 是「万一聚焦了就丢掉」，两条是一对。
 *
 * ⚠ 这不是「无障碍上的优化」，而是**刻意的取舍**：子树里的按钮从此键盘够不着（读屏也点不动
 *   它们），只能用鼠标点。迷你窗作为挂件接受了这一点 —— 主窗口那边一切照旧。
 * ⚠ 它管的是**页面内的焦点**。点一下迷你窗会让**窗口本身**被激活（抢走主窗口的键盘焦点），
 *   那是窗口级的事，DOM 拦不住（要拦得给 BrowserWindow 设 focusable: false）。
 */

import { useEffect, useRef } from 'react'

/** 会被浏览器放进 Tab 顺序的那些元素（与 HTML 规范的「可聚焦区域」对齐） */
const FOCUSABLE = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]'
].join(',')

export function useUnfocusable<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    /* ① 静态摘除：写 -1 之前先比一次属性，避免「写 → 观察器触发 → 再写」的空转 */
    const strip = (): void => {
      for (const el of root.querySelectorAll(FOCUSABLE)) {
        if (el.getAttribute('tabindex') !== '-1') el.setAttribute('tabindex', '-1')
      }
    }
    strip()

    /* ② 新来的与 React 重写回来的，一并摘掉 */
    const observer = new MutationObserver(strip)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['tabindex']
    })

    /* ③ 按下即聚焦 → 把这条默认行为掐掉：连那一瞬的焦点都不给它（点击本身照旧触发） */
    const blockMouseFocus = (event: MouseEvent): void => {
      event.preventDefault()
    }
    root.addEventListener('mousedown', blockMouseFocus, true)

    /* ④ 程序化（以及漏网的）focus() 拦不住，但它一定会触发 focusin —— 当场交还焦点 */
    const dropFocus = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && root.contains(target)) target.blur()
    }
    root.addEventListener('focusin', dropFocus)

    return () => {
      observer.disconnect()
      root.removeEventListener('mousedown', blockMouseFocus, true)
      root.removeEventListener('focusin', dropFocus)
    }
  }, [])

  return ref
}

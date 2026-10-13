/**
 * 让一行内容横向滚动得顺手：**滚轮转横向** + **按住拖动**（鼠标左键）。
 *
 * 为什么这两件事只能写在这里、交给 CSS 不行：
 *   * 光有横向滚动条等于没有 —— 它细、还是横的，而鼠标滚轮默认只滚纵向；
 *   * React 的 onWheel 挂在根节点上且是 **passive** 的，在里面 preventDefault 不生效，
 *     要拦下页面滚动只能用原生监听 + `{ passive: false }`。
 *
 * ★ 接线走**回调 ref**，不用 `useEffect + useRef`：这一行是**条件渲染**的（加载中是骨架屏、
 *   空库时是空状态），它挂载的时刻晚于组件第一次 effect —— 那时 ref 还是 null，而空依赖的
 *   effect 之后再也不会跑，于是监听器一个都没挂上、拖动与滚轮全部静默失效（真实踩过的坑）。
 *   回调 ref 在节点真正出现时才被调用，与渲染顺序无关。
 *   注意它的 identity 必须是稳定的（useCallback 空依赖）：每渲染变一次，React 就会
 *   「解绑再绑定」，拖到一半被拆掉、指针捕获也跟着丢。
 *
 * 滚轮部分的两个取舍：
 *   * **已经贴边就放行**：鼠标停在这一行上时若把滚轮全吃掉，页面就哪儿都滚不动了；
 *   * 但**先夹到端点再判断**：还剩一点就把它滚完，免得最后一段永远滚不到（放行得留给
 *     「确实一点都滚不动」那一刻）。
 *
 * 拖动部分的三条约束，少一件「拖」就会变成「点」：
 *   * **超阈值才算拖动**：按下不动就是普通点击，行内按钮（如封面上的播放键）照常工作。
 *     阈值内也刻意**不** capture 指针 —— 一 capture，后续指针事件连配套的 click
 *     都会被重定向，普通点击没必要冒这个险。
 *   * **拖过之后吃掉那次 click**：松开时浏览器仍会补一个 click，它的落点由**按下位置**
 *     决定，与中间拖到哪儿无关 —— 不拦掉的话，横向拖一下就会顺带播放。
 *   * **只接管鼠标**：触摸/触控板的横向手势交给浏览器原生平移，两边一起动只会打架。
 *
 * 返回的 `dragging` 供调用方切换光标（grab ↔ grabbing）。
 */

import { useCallback, useState } from 'react'

/** 小于这个位移不算拖动（像素） */
const DRAG_THRESHOLD = 5

export function useHorizontalScroll(): {
  ref: React.RefCallback<HTMLDivElement>
  dragging: boolean
} {
  const [dragging, setDragging] = useState(false)

  const ref = useCallback<React.RefCallback<HTMLDivElement>>((el) => {
    if (!el) return undefined
    return attach(el, setDragging)
  }, [])

  return { ref, dragging }
}

/** 把滚轮与拖动接到元素上，返回解绑函数 */
function attach(el: HTMLDivElement, setDragging: (dragging: boolean) => void): () => void {
  const onWheel = (event: WheelEvent): void => {
    // 本身就是横向的手势（触控板双指左右、Shift+滚轮）让浏览器自己滚，不两头抢
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 0) return
    const next = Math.min(Math.max(el.scrollLeft + event.deltaY, 0), max)
    // 只剩不到半像素可滚：说明到端点了，这一下交给页面
    if (Math.abs(next - el.scrollLeft) < 0.5) return
    event.preventDefault()
    el.scrollLeft = next
  }

  let pointerId: number | null = null
  let startX = 0
  let startScroll = 0
  let moved = false

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    pointerId = event.pointerId
    startX = event.clientX
    startScroll = el.scrollLeft
    // 每次按下都重置：上一次拖动留下的标记不能吃掉这一次的正常点击
    moved = false
  }

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    const delta = event.clientX - startX
    if (!moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return
      moved = true
      setDragging(true)
      // 到这一步已经确定是拖动：捕获指针，拖出行外也继续跟手
      el.setPointerCapture(event.pointerId)
    }
    el.scrollLeft = startScroll - delta
  }

  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
    pointerId = null
    setDragging(false)
  }

  const onClick = (event: MouseEvent): void => {
    if (!moved) return
    event.preventDefault()
    event.stopPropagation()
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
  // 捕获阶段拦：不能让这次 click 落到卡片或按钮上
  el.addEventListener('click', onClick, true)
  return () => {
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    el.removeEventListener('click', onClick, true)
    // 解绑时把光标状态复位：否则行消失（加载中/空库）再回来会停在 grabbing
    setDragging(false)
  }
}

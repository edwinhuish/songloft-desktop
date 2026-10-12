/**
 * 全局 tooltip 浮层。
 *
 * ★ 为什么不把它做成「挂在元素自己身上的伪元素」（侧栏导航项最初正是那么做的）：
 *   歌单列表是滚动容器，而滚动容器的 overflow **一定**会剪掉伸出它之外的伪元素 ——
 *   并且两个轴不能只放开一个：当一个轴是 visible、另一个是 auto 时，visible 会被
 *   算成 auto，照样剪。所以浮层必须渲染到滚动容器之外。
 *
 *   这里做成挂在 App 根部的单例（与 ContextMenuHost 同一个路子）：宿主不在任何
 *   滚动容器里，配合 fixed 定位就与被提示元素所处的滚动结构无关了。
 */

import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * 悬停多久才弹。
 *
 * 侧栏紧贴着主内容区，鼠标横穿它（去点主区的东西、去够滚动条）是常事。条件反射式地
 * 立刻弹，结果是每次路过都闪出一片浮层；而「鼠标早走开了、浮层还留在屏幕上」也多半
 * 是这么来的 —— 人在等待期里就已经离开了。等一小会儿再弹，等待期内离开就整个不弹，
 * 连「要收掉的东西」都不存在。
 */
const SHOW_DELAY = 400

interface TipState {
  text: string
  /** 视口坐标：提示框左边缘与垂直中心对齐到被提示元素的右缘中点 */
  x: number
  y: number
  /** 被提示的元素。宿主靠它判断指针是不是还停在上面 */
  anchor: HTMLElement | null
  show: (x: number, y: number, text: string, anchor: HTMLElement) => void
  hide: () => void
}

export const useTooltip = create<TipState>((set) => ({
  text: '',
  x: 0,
  y: 0,
  anchor: null,
  show: (x, y, text, anchor) => set({ text, x, y, anchor }),
  hide: () => set({ text: '', anchor: null })
}))

/** 待弹的那一次。同一时刻最多只有一个（鼠标只可能停在一个地方） */
let showTimer: ReturnType<typeof setTimeout> | null = null

function cancelPendingShow(): void {
  if (showTimer === null) return
  clearTimeout(showTimer)
  showTimer = null
}

/** 挂到 onMouseEnter 上：以元素的右缘中点为锚点，等一小会儿再弹 */
export function showTip(event: React.MouseEvent<HTMLElement>, text: string): void {
  cancelPendingShow()
  const anchor = event.currentTarget
  showTimer = setTimeout(() => {
    showTimer = null
    // ★ 到点再量坐标：等待期间侧栏可能正好在展开/收起，进入那一刻量的位置已经不作数了。
    //   元素若已不在文档里（列表被重渲染）就什么也不弹 —— 量出来会是全 0，浮层会跑到左上角。
    if (!anchor.isConnected) return
    const rect = anchor.getBoundingClientRect()
    useTooltip.getState().show(rect.right + 10, rect.top + rect.height / 2, text, anchor)
  }, SHOW_DELAY)
}

/** 挂到 onMouseLeave 上：连「还没弹出来的那一次」一起取消 */
export function hideTip(): void {
  cancelPendingShow()
  useTooltip.getState().hide()
}

export function TooltipHost(): React.JSX.Element | null {
  const { text, x, y, anchor, hide } = useTooltip()

  /**
   * 浮层只该在指针仍停在被提示元素上时存在。
   *
   * ★ 光有 onMouseLeave 不够，原因是「leave 不一定会来」：
   *   1. 布局一变（窗口变宽触发的侧栏自动展开）元素就从指针底下挪走了，这不派发 leave；
   *   2. 侧栏折叠态切换时 `tip()` 会把整个 props 换掉，onMouseLeave 可能已经不在元素上了。
   *   两种情况下指针明明不在元素上，浮层却留在原地。所以再加一道与「有没有 leave」
   *   无关的兜底：指针一旦不在锚点里，收。
   */
  useEffect(() => {
    if (!anchor) return
    const onPointerMove = (event: PointerEvent): void => {
      if (event.target instanceof Node && anchor.contains(event.target)) return
      hide()
    }
    const onLayoutShift = (): void => hide()
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('resize', onLayoutShift)
    window.addEventListener('blur', onLayoutShift)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', onLayoutShift)
      window.removeEventListener('blur', onLayoutShift)
    }
  }, [anchor, hide])

  if (!text) return null
  // aria-hidden：折叠态的名字在 DOM 里仍然有（.nav-text 只是淡出，不是移除），
  // 屏幕阅读器读得到，这一层纯粹是补视觉
  return (
    <div className="tip" aria-hidden="true" style={{ left: x, top: y }}>
      {text}
    </div>
  )
}

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

import { create } from 'zustand'

interface TipState {
  text: string
  /** 视口坐标：提示框左边缘与垂直中心对齐到被提示元素的右缘中点 */
  x: number
  y: number
  show: (x: number, y: number, text: string) => void
  hide: () => void
}

export const useTooltip = create<TipState>((set) => ({
  text: '',
  x: 0,
  y: 0,
  show: (x, y, text) => set({ text, x, y }),
  hide: () => set({ text: '' })
}))

/** 在元素的右缘中点弹出它的提示（直接挂到 onMouseEnter 上） */
export function showTip(event: React.MouseEvent<HTMLElement>, text: string): void {
  const rect = event.currentTarget.getBoundingClientRect()
  useTooltip.getState().show(rect.right + 10, rect.top + rect.height / 2, text)
}

/** 直接挂到 onMouseLeave 上 */
export function hideTip(): void {
  useTooltip.getState().hide()
}

export function TooltipHost(): React.JSX.Element | null {
  const { text, x, y } = useTooltip()
  if (!text) return null
  // aria-hidden：折叠态的名字在 DOM 里仍然有（.nav-text 只是淡出，不是移除），
  // 屏幕阅读器读得到，这一层纯粹是补视觉
  return (
    <div className="tip" aria-hidden="true" style={{ left: x, top: y }}>
      {text}
    </div>
  )
}

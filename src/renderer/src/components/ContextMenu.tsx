/**
 * 右键菜单 / 下拉菜单宿主。
 *
 * 做成挂在 App 根部的单例（而不是每个列表行各渲染一份）：
 * 一个 5000 行的列表如果每行都挂一个菜单组件，右键时的开销会很难看。
 */

import { create } from 'zustand'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
  /** 渲染成一条分组小标题（不可点） */
  header?: boolean
  /** 渲染成分隔线 */
  separator?: boolean
}

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  /**
   * 打开这个菜单的元素（可选）。给「点同一个按钮 = 收起」这种下拉留的。
   *
   * 下面「点哪里都关」的监听挂在 **window 捕获阶段**，比被点元素自己的 onClick 还早，
   * 于是按钮根本读不到「菜单此刻开着」，收起逻辑永远做不出来（点一次：先被关、再被
   * onClick 打开，看起来像点不掉）。认下这个元素，这一次判断交还给按钮。
   */
  anchor: HTMLElement | null
  show: (x: number, y: number, items: MenuItem[], anchor?: HTMLElement | null) => void
  hide: () => void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  anchor: null,
  show: (x, y, items, anchor = null) => set({ open: true, x, y, items, anchor }),
  hide: () => set({ open: false, items: [], anchor: null })
}))

/** 从鼠标事件直接打开菜单（自动取坐标并阻止默认菜单） */
export function openMenuFromEvent(event: React.MouseEvent | MouseEvent, items: MenuItem[]): void {
  event.preventDefault()
  event.stopPropagation()
  useContextMenu.getState().show(event.clientX, event.clientY, items)
}

export function ContextMenuHost(): React.JSX.Element | null {
  const { open, x, y, items, anchor, hide } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // 贴边翻转：菜单不能跑出窗口
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    setPosition({ left: Math.max(6, left), top: Math.max(6, top) })
  }, [open, x, y, items.length])

  useEffect(() => {
    if (!open) return
    const close = (): void => hide()
    /**
     * 「点别处就关」。用捕获阶段是为了抢在被点元素的 onClick 之前收掉菜单。
     *
     * ★ 但**菜单自己**与**触发器**上的按下不能算「别处」：
     *   前者的点击要留给菜单项自己的 onClick（它会 hide 后再执行动作）；
     *   后者的点击要留给按钮去判断是收起还是重新展开。
     *
     * ★ 为什么不能靠「在菜单根节点上 stopPropagation」来拦：这个监听在捕获阶段的
     *   window 上，比事件走到任何元素都早，stopPropagation 拦不住它。菜单会在
     *   pointerdown 时就被卸载，于是随后 pointerup 派发的 click 找不到目标元素而
     *   **整个消失** —— 症状是菜单项点不动、不报错、也点不到菜单底下的东西（在真实
     *   Chromium 上复现过）。所以这里只能在监听内部把这两处放行。
     */
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      hide()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, hide, anchor])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => {
        if (item.separator) return <hr key={item.key} />
        if (item.header)
          return (
            <div key={item.key} className="menu-sub">
              {item.label}
            </div>
          )
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            data-variant={item.variant ?? 'default'}
            disabled={item.disabled}
            onClick={() => {
              hide()
              item.onClick?.()
            }}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

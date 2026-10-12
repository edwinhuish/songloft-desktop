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
  show: (x: number, y: number, items: MenuItem[]) => void
  hide: () => void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false, items: [] })
}))

/** 从鼠标事件直接打开菜单（自动取坐标并阻止默认菜单） */
export function openMenuFromEvent(event: React.MouseEvent | MouseEvent, items: MenuItem[]): void {
  event.preventDefault()
  event.stopPropagation()
  useContextMenu.getState().show(event.clientX, event.clientY, items)
}

export function ContextMenuHost(): React.JSX.Element | null {
  const { open, x, y, items, hide } = useContextMenu()
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
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    // 捕获阶段监听：让「点任何地方都关」优先于被点元素的 onClick
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, hide])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
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

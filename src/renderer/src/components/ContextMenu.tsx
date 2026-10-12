/**
 * 右键菜单 / 下拉菜单宿主，支持一级级联（子菜单）。
 *
 * 做成挂在 App 根部的单例（而不是每个列表行各渲染一份）：
 * 一个 5000 行的列表如果每行都挂一个菜单组件，右键时的开销会很难看。
 */

import { create } from 'zustand'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { IconChevronRight } from './Icons'

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
  /** 二级菜单。有它就说明这一项不是叶子：点它只展开，不关掉整份菜单 */
  children?: MenuItem[]
}

/**
 * 面板类名。既是样式钩子，也是「这次点击落在菜单里吗」的判据（见下面的 pointerdown
 * 放行）—— 子菜单是另一棵子树，靠 ref 一层层认不好认，直接问 DOM 更稳。
 * 两处必须是同一个字符串，所以只留这一个常量。
 */
const PANEL_CLASS = 'context-menu'

/** 菜单与窗口边缘留的空隙 */
const EDGE = 8
/** 子菜单与触发项之间的空隙 */
const SUBMENU_GAP = 4
/** 指针离开一层之后，子菜单慢半拍再收：留出从父项挪进子菜单的时间 */
const SUBMENU_LINGER = 160

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  /**
   * 打开这个菜单的元素（可选）。给「点同一个按钮 = 收起」这种下拉留的。
   *
   * 「点哪里都关」的监听挂在 **window 捕获阶段**，比被点元素自己的 onClick 还早，
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

/**
 * 把面板夹回窗口内。
 *
 * 尺寸只有布局之后才知道，所以位置一定是在 layout effect 里定的（见 MenuPanel）。
 * 传了 anchorRect 说明这是一层子菜单：优先贴触发项的右侧，右边实在放不下才翻到左侧。
 */
function placePanel(
  size: { width: number; height: number },
  want: { x: number; y: number },
  anchorRect?: DOMRect | null
): { left: number; top: number } {
  const rightward = anchorRect ? anchorRect.right + SUBMENU_GAP : want.x
  const leftward = anchorRect ? anchorRect.left - size.width - SUBMENU_GAP : want.x
  const left =
    anchorRect && rightward + size.width > window.innerWidth - EDGE ? leftward : rightward
  return {
    left: Math.max(6, Math.min(left, window.innerWidth - size.width - EDGE)),
    top: Math.max(6, Math.min(want.y, window.innerHeight - size.height - EDGE))
  }
}

interface MenuPanelProps {
  items: MenuItem[]
  /** 期望位置（视口坐标）：根菜单给鼠标坐标，子菜单给触发项的右缘 / 顶边 */
  x: number
  y: number
  /** 有值即表示这是子菜单（用它判断往右还是往左翻） */
  anchorRect?: DOMRect | null
  onClose: () => void
  /** 指针回到本层：父层据此取消「慢半拍收子菜单」 */
  onEnter?: () => void
  /** 指针离开本层：父层据此起算「慢半拍」 */
  onLeave?: () => void
}

/**
 * 一层菜单。子菜单就是再来一个 MenuPanel，所以是递归的。
 *
 * 位置拆成 x / y 两个数字而不是一个 {x,y}：effect 的依赖要是稳定的原始值，
 * 传对象的话每次渲染都是新引用，effect 会「自己触发自己」（setPosition 拿到的是新对象）。
 */
function MenuPanel({
  items,
  x,
  y,
  anchorRect,
  onClose,
  onEnter,
  onLeave
}: MenuPanelProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [sub, setSub] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPosition(placePanel(el.getBoundingClientRect(), { x, y }, anchorRect))
  }, [x, y, anchorRect, items.length])

  useEffect(
    () => () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    },
    []
  )

  const cancelLinger = (): void => {
    if (lingerTimer.current === null) return
    clearTimeout(lingerTimer.current)
    lingerTimer.current = null
  }

  /** 指针走了：慢半拍再收子菜单（期间指针若进了子菜单，会被它取消） */
  const startLinger = (): void => {
    cancelLinger()
    lingerTimer.current = setTimeout(() => {
      lingerTimer.current = null
      setSub(null)
    }, SUBMENU_LINGER)
  }

  return (
    <>
      <div
        ref={ref}
        className={PANEL_CLASS}
        role="menu"
        style={{ left: position.left, top: position.top }}
        onPointerEnter={() => {
          // 指针回到本层 = 刚才那次「慢半拍」不作数了（自己的子菜单先留住），
          // 同时通知父层：别把本层收掉
          cancelLinger()
          onEnter?.()
        }}
        onPointerLeave={() => {
          onLeave?.()
          startLinger()
        }}
      >
        {items.map((item) => {
          if (item.separator) return <hr key={item.key} />
          if (item.header)
            return (
              <div key={item.key} className="menu-sub">
                {item.label}
              </div>
            )

          const subItems = item.children ?? []
          const expanded = Boolean(sub && sub.item.key === item.key)
          const openSub = (event: React.MouseEvent<HTMLButtonElement>): void => {
            if (subItems.length === 0) {
              setSub(null)
              return
            }
            cancelLinger()
            setSub({ item, rect: event.currentTarget.getBoundingClientRect() })
          }

          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-haspopup={subItems.length > 0 ? 'menu' : undefined}
              aria-expanded={subItems.length > 0 ? expanded : undefined}
              data-variant={item.variant ?? 'default'}
              data-expanded={expanded}
              disabled={item.disabled}
              // 悬浮即展开；点一下也展开（触屏 / 手快时 hover 来不及），两者等价
              onPointerEnter={openSub}
              onClick={(event) => {
                if (subItems.length > 0) {
                  openSub(event)
                  return
                }
                onClose()
                item.onClick?.()
              }}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {subItems.length > 0 ? <IconChevronRight size={14} className="menu-arrow" /> : null}
            </button>
          )
        })}
      </div>

      {sub ? (
        <MenuPanel
          key={sub.item.key}
          items={sub.item.children ?? []}
          x={sub.rect.right + SUBMENU_GAP}
          y={sub.rect.top}
          anchorRect={sub.rect}
          onClose={onClose}
          onEnter={cancelLinger}
          onLeave={startLinger}
        />
      ) : null}
    </>
  )
}

export function ContextMenuHost(): React.JSX.Element | null {
  const { open, x, y, items, anchor, hide } = useContextMenu()

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
      if (!(target instanceof Element)) return
      if (target.closest(`.${PANEL_CLASS}`) || anchor?.contains(target)) return
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

  return <MenuPanel items={items} x={x} y={y} onClose={hide} />
}

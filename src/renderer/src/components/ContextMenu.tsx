/**
 * 右键菜单 / 下拉菜单宿主，支持一级级联（子菜单）。
 *
 * 做成挂在 App 根部的单例（而不是每个列表行各渲染一份）：
 * 一个 5000 行的列表如果每行都挂一个菜单组件，右键时的开销会很难看。
 */

import { create } from 'zustand'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { IconCheck, IconChevronRight } from './Icons'

/**
 * 菜单里的滑块行。用于**就地**调一个连续量（如窗口不透明度）：拖着看效果，
 * 不必先跳去设置页。
 */
export interface MenuSlider {
  min: number
  max: number
  value: number
  /** 拖动过程中每次变化都回调（要不要节流/什么时候落盘由调用方定） */
  onChange: (value: number) => void
  /** 数值后面那个单位，默认 `%` */
  suffix?: string
}

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
  /**
   * 渲染成一条「标签 + 滑块」（不是按钮）。`label` 就是这一行的标题。
   *
   * ★ 值由这一行**自己**管（见 MenuSliderRow）：菜单是一份**快照**（开菜单那一刻存下来的
   *   数组），受控于快照里那个 value 的话，滑块一松手就弹回原位 —— 等于拖不动。
   */
  slider?: MenuSlider
  /**
   * 二级菜单：悬浮即展开。
   *
   * 带 children 的项**同时带 onClick** 时是「双面」的 —— 悬浮看二级菜单、单击执行动作
   * 并关掉整份菜单（折叠菜单里的「歌单」就是这种：悬浮列歌单，点进歌单页）；
   * 不带 onClick 的则纯粹是展开用的父项，点它只展开。
   */
  children?: MenuItem[]
  /**
   * 单选下拉（SettingSelect）用：给了 checked 就渲染成 `menuitemradio`，
   * 左边让出一列打勾。**必须每一项都给**（选中的给 true、其余给 false），
   * 否则同一份菜单里有的项留了勾位列、有的没留，文字会左右错开。
   */
  checked?: boolean
  /** 选项的第二行说明；一旦有任何一项给了它，整层菜单改成两行高 */
  desc?: string
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

/**
 * 下拉面板与触发器的对齐方式（见 SettingSelect）。
 * 不给则按鼠标坐标摆（右键菜单），子菜单另走「贴触发项右侧、放不下就翻左」。
 */
export type MenuAlign = 'left' | 'right'

export interface MenuShowOptions {
  /**
   * 打开这个菜单的元素。给「点同一个按钮 = 收起」这种下拉用。
   *
   * 「点哪里都关」的监听挂在 **window 捕获阶段**，比被点元素自己的 onClick 还早，
   * 于是按钮根本读不到「菜单此刻开着」，收起逻辑永远做不出来（点一次：先被关、再被
   * onClick 打开，看起来像点不掉）。认下这个元素，这一次判断交还给按钮。
   */
  anchor?: HTMLElement | null
  /** 只对下拉式菜单有意义：面板左缘贴触发器左缘，还是右缘贴触发器右缘 */
  align?: MenuAlign | null
  /** 触发器的位置（下拉式菜单靠它对齐；右键菜单不需要） */
  anchorRect?: DOMRect | null
}

interface MenuState extends Required<MenuShowOptions> {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  show: (x: number, y: number, items: MenuItem[], options?: MenuShowOptions) => void
  hide: () => void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  anchor: null,
  align: null,
  anchorRect: null,
  show: (x, y, items, options = {}) =>
    set({
      open: true,
      x,
      y,
      items,
      anchor: options.anchor ?? null,
      align: options.align ?? null,
      anchorRect: options.anchorRect ?? null
    }),
  hide: () => set({ open: false, items: [], anchor: null, align: null, anchorRect: null })
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
 *
 * 三种摆法，按优先级：
 *   1. 下拉（给了 align）→ 左缘对齐触发器左缘，或右缘对齐触发器右缘。
 *      「长在设置行右端」的触发器必须右对齐：左对齐会让面板越出卡片右缘，
 *      宽一点就直接贴到窗口边上，看着像掉出来了。
 *   2. 子菜单（给了 anchorRect 没给 align）→ 贴触发项右侧，右边放不下才翻到左侧。
 *   3. 其余（右键菜单）→ 就用鼠标坐标。
 */
function placePanel(
  size: { width: number; height: number },
  want: { x: number; y: number },
  anchorRect?: DOMRect | null,
  align?: MenuAlign | null
): { left: number; top: number } {
  let left = want.x
  if (anchorRect && align === 'right') left = anchorRect.right - size.width
  else if (anchorRect && align === 'left') left = anchorRect.left
  else if (anchorRect) {
    left =
      anchorRect.right + SUBMENU_GAP + size.width > window.innerWidth - EDGE
        ? anchorRect.left - size.width - SUBMENU_GAP
        : anchorRect.right + SUBMENU_GAP
  }
  return {
    left: Math.max(6, Math.min(left, window.innerWidth - size.width - EDGE)),
    top: Math.max(6, Math.min(want.y, window.innerHeight - size.height - EDGE))
  }
}

/**
 * 菜单里的滑块行：上面一行是「标题 + 当前值」，下面一条 range。
 *
 * ★ 这个值**只存在这一行里**，不回读设置，也不由外层受控。两个理由：
 *   ① 菜单是一份快照（`show(…)` 时存下的数组），它不会跟着设置变 —— 受控于快照的话
 *      滑块松手就弹回打开菜单那一刻的位置；
 *   ② 拖动时也不必惊动菜单的其余部分（重渲染整份菜单意味着子菜单位置等一串 effect 跟着跑）。
 *   「真的改了没有」由 onChange 落到 store 上，与设置页那两个滑块是同一条路径。
 * ★ 用 div 而不是 button：range 放进 button 里既非法也不可点（button 会吞掉指针事件）。
 */
function MenuSliderRow({
  item,
  slider
}: {
  item: MenuItem
  slider: MenuSlider
}): React.JSX.Element {
  const [value, setValue] = useState(slider.value)
  const id = `menu-slider-${item.key}`
  return (
    <div className="menu-slider" role="none">
      <label className="menu-slider-head" htmlFor={id}>
        <span className="truncate">{item.label}</span>
        <span className="menu-slider-value">
          {value}
          {slider.suffix ?? '%'}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={slider.min}
        max={slider.max}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value)
          setValue(next)
          slider.onChange(next)
        }}
      />
    </div>
  )
}

interface MenuPanelProps {
  items: MenuItem[]
  /** 期望位置（视口坐标）：根菜单给鼠标坐标，子菜单给触发项的右缘 / 顶边 */
  x: number
  y: number
  /** 有值即表示这是子菜单（用它判断往右还是往左翻）；下拉式菜单则配合 align 对齐触发器 */
  anchorRect?: DOMRect | null
  /** 下拉式菜单的对齐方式；子菜单与右键菜单都不给 */
  align?: MenuAlign | null
  onClose: () => void
  /** 指针回到本层：父层据此取消「慢半拍收子菜单」 */
  onEnter?: () => void
  /** 指针离开本层：父层据此起算「慢半拍」 */
  onLeave?: () => void
  /**
   * 窗口尺寸变化的计数（见宿主里那条 resize 说明）。一变就重摆一次本层，并收掉子菜单 ——
   * 子菜单的位置来自「父项那一刻的 rect」，父项重摆之后那份 rect 就过时了。
   * 只有根菜单拿得到它（子菜单不传，默认 0）。
   */
  resizeTick?: number
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
  align,
  onClose,
  onEnter,
  onLeave,
  resizeTick = 0
}: MenuPanelProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [sub, setSub] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 单选下拉的样子：留出勾位列、条目可以是两行。整个面板统一，不逐项判断 */
  const rich = items.some((item) => item.checked !== undefined || item.desc !== undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // 尺寸变了就得重新量：面板自己的高宽也会跟着变（.context-menu 的 max-height 是 60vh）
    setPosition(placePanel(el.getBoundingClientRect(), { x, y }, anchorRect, align))
    setSub(null)
  }, [x, y, anchorRect, align, items.length, resizeTick])

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
        data-rich={rich ? 'true' : undefined}
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
          if (item.slider) return <MenuSliderRow key={item.key} item={item} slider={item.slider} />

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
              role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
              aria-checked={item.checked !== undefined ? Boolean(item.checked) : undefined}
              aria-haspopup={subItems.length > 0 ? 'menu' : undefined}
              aria-expanded={subItems.length > 0 ? expanded : undefined}
              data-variant={item.variant ?? 'default'}
              data-expanded={expanded}
              disabled={item.disabled}
              onPointerEnter={openSub}
              onClick={(event) => {
                // 有动作就先执行动作（如「歌单」进歌单页）。只有二级菜单的父项才是
                // 「点一下也展开」—— 触屏与手快时 hover 来不及，总得留个入口
                if (item.onClick) {
                  onClose()
                  item.onClick()
                  return
                }
                if (subItems.length > 0) openSub(event)
              }}
            >
              {item.icon}
              {rich ? (
                <span className="menu-check" aria-hidden="true">
                  {item.checked ? <IconCheck size={14} /> : null}
                </span>
              ) : null}
              {item.desc ? (
                <span className="menu-text">
                  <span className="truncate">{item.label}</span>
                  <span className="menu-desc truncate">{item.desc}</span>
                </span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
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
  const { open, x, y, items, anchor, align, anchorRect, hide } = useContextMenu()
  /** 窗口尺寸变化的计数：见下面 resize 那一段（只有根面板关心它） */
  const [resizeTick, setResizeTick] = useState(0)

  /**
   * 把「有菜单开着」这件事发布给 CSS。
   *
   * 有两处「点一下」根本冒不到宿主的 window，全靠这条标记先把它们让开：
   *   * 标题栏的拖拽区 —— 那一下按下会被浏览器拿去拖窗口，页面收不到 pointerdown；
   *   * 扩展页的 webview —— guest 是独立进程，点在它上面的那一下也不会冒上来。
   * 不让开的话，「点别处关掉菜单」在这两处各自断掉，菜单只能靠再点一次触发器才关得掉。
   *
   * 为什么写进 `documentElement.dataset` 而不是让某个组件渲染一个属性：这条规则要管到
   * 整棵文档，能同时覆盖这两处的 React 组件是 Shell —— 让它订阅菜单状态意味着**每开关
   * 一次菜单就整页重渲染一次**（列表可能有几千行）。用 dataset 发布一个全局 UI 模式，
   * 零重渲染。规则本体在 base.css 里（`html[data-menu='open'] …`）。
   */
  useEffect(() => {
    const root = document.documentElement
    if (!open) {
      delete root.dataset.menu
      return
    }
    root.dataset.menu = 'open'
    // 卸载（例如退出登录）时也要撤掉：留着的话标题栏会一直丢掉拖拽区
    return () => {
      delete root.dataset.menu
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (): void => hide()
    /**
     * 窗口尺寸变了：**重摆一次**，而不是关掉整份菜单。
     *
     * ★ 原来这里是 resize → 关闭，理由同样成立：菜单是按鼠标坐标摆的，窗口一变那份坐标
     *   就旧了。但「旧」的是**可见范围**，不是鼠标位置本身 —— 拿同一对 x/y 重跑一次
     *   placePanel（它本来就会把面板夹回窗口内）恰好就是要的结果。
     * ★ 这条现在是必需的：迷你窗为了放下右键菜单要临时长高（main/windows.ts 的
     *   MINI_MENU_SIZE），而窗口一长高就会派发 resize —— 若还按老规矩关菜单，用户刚点开
     *   的菜单会被窗口自己关掉，等于这个功能根本用不了。重摆一次则正好从「被夹成一条缝」
     *   回到正常尺寸，而且仍贴着刚才点击的地方。
     */
    const onResize = (): void => setResizeTick((tick) => tick + 1)
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
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, hide, anchor])

  if (!open) return null

  return (
    <MenuPanel
      items={items}
      x={x}
      y={y}
      anchorRect={anchorRect}
      align={align}
      onClose={hide}
      resizeTick={resizeTick}
    />
  )
}

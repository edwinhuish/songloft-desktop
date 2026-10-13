/**
 * 全局小提示（tooltip）。
 *
 * 两个设计决定：
 *
 * 1. **浮层渲染到滚动容器之外。** 歌单列表是滚动容器，而滚动容器的 overflow **一定**
 *    会剪掉伸出它之外的伪元素 —— 并且两个轴不能只放开一个：当一个轴是 visible、
 *    另一个是 auto 时，visible 会被算成 auto，照样剪。所以它是挂在 App 根部的单例
 *    （与 ContextMenuHost 同一个路子），配合 fixed 定位就与被提示元素所处的滚动结构无关。
 *
 * 2. **触发靠 `data-tip` 属性 + 一份全局指针监听，而不是逐处挂 onMouseEnter。**
 *    全应用有几十处提示，逐处挂两个 handler 既啰嗦又必然漏；属性化之后写提示和写
 *    `title` 一样顺手，延时、定位、收场全由这里一处负责 —— 只有一份行为，也就不会
 *    出现「这一处能弹、那一处不弹」。（顺带把浏览器自带黑框换掉了：它的出现时机、
 *    停留时长、配色都不受应用控制，在浅色主题下尤其突兀。）
 *
 * 外观见 styles/components.css 的 `.tip`：颜色全走主题 token，浅色/深色各自成立。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

/** 提示文案写在这个属性上：`<button data-tip="收起面板">` */
export const TIP_ATTR = 'data-tip'
/** 提示框与被提示元素之间的间隙 */
const GAP = 10
/** 与视口边缘至少留出来的空隙 */
const MARGIN = 8

/**
 * 悬停多久才弹。
 *
 * 侧栏紧贴着主内容区，鼠标横穿它（去点主区的东西、去够滚动条）是常事。条件反射式地
 * 立刻弹，结果是每次路过都闪出一片浮层；而「鼠标早走开了、浮层还留在屏幕上」也多半
 * 是这么来的 —— 人在等待期里就已经离开了。等一小会儿再弹，等待期内离开就整个不弹，
 * 连「要收掉的东西」都不存在。
 */
const SHOW_DELAY = 400

/** 被提示元素的视口矩形（量一次记下来，定位时不再反复读布局） */
interface TipRect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

interface TipState {
  text: string
  rect: TipRect | null
  /** 被提示的元素。宿主靠它判断指针是不是还停在上面 */
  anchor: HTMLElement | null
  show: (rect: TipRect, text: string, anchor: HTMLElement) => void
  hide: () => void
}

export const useTooltip = create<TipState>((set) => ({
  text: '',
  rect: null,
  anchor: null,
  show: (rect, text, anchor) => set({ text, rect, anchor }),
  // 已经收起来时返回原状态对象：滚动等高频事件会反复喊 hide，不该每次都惊动订阅者
  hide: () => set((state) => (state.text === '' ? state : { text: '', rect: null, anchor: null }))
}))

/** 待弹的那一次。同一时刻最多只有一个（鼠标只可能停在一个地方） */
let showTimer: ReturnType<typeof setTimeout> | null = null
/** 已排期或正在显示的那个元素 */
let armedAnchor: HTMLElement | null = null

function cancelPendingShow(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  armedAnchor = null
}

function hideTip(): void {
  cancelPendingShow()
  useTooltip.getState().hide()
}

function rectOf(element: HTMLElement): TipRect {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  }
}

/**
 * 指针底下那个带提示的元素。
 *
 * 先看事件目标（绝大多数情况，也最便宜），它不行时再用坐标反查：
 * **disabled 的按钮/输入框在 Chromium 里不派发指针事件**（事件目标落到父节点上），
 * 而「这个按钮为什么点不了」恰恰是最需要提示的地方 —— `elementFromPoint` 走的是命中测试，
 * 不受事件派发规则影响。
 */
function tipTargetAt(event: PointerEvent): HTMLElement | null {
  const fromEvent =
    event.target instanceof Element ? event.target.closest<HTMLElement>(`[${TIP_ATTR}]`) : null
  if (fromEvent) return fromEvent
  return (
    document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null
  )
}

/** 排一次「等一小会儿再弹」；等待期内离开就整个不弹 */
function scheduleShow(anchor: HTMLElement): void {
  const text = anchor.getAttribute(TIP_ATTR) ?? ''
  if (!text) return
  // 指针还在同一个元素里挪（划到它的子节点上）：保持现状，不要重排计时器
  if (anchor === armedAnchor || anchor === useTooltip.getState().anchor) return
  // 换到别的元素：先把上一个收掉，别让旧提示挂在新位置旁边
  cancelPendingShow()
  useTooltip.getState().hide()
  armedAnchor = anchor
  showTimer = setTimeout(() => {
    showTimer = null
    // ★ 到点再量坐标：等待期间侧栏可能正好在展开/收起，进入那一刻量的位置已经不作数了。
    //   元素若已不在文档里（列表被重渲染）就什么也不弹 —— 量出来会是全 0，浮层会跑到左上角。
    if (!anchor.isConnected) return
    useTooltip.getState().show(rectOf(anchor), text, anchor)
  }, SHOW_DELAY)
}

let listenersBound = false

/**
 * 全局监听挂在模块级而不是某个组件的 effect 里：语义上它就只有一份，
 * 顺带也躲开 StrictMode 下 effect 的重复挂载与卸载。
 */
function bindGlobalListeners(): void {
  if (listenersBound) return
  listenersBound = true

  document.addEventListener('pointerover', (event) => {
    const target = tipTargetAt(event)
    if (target) {
      scheduleShow(target)
      return
    }
    // 走到没有提示的元素上：排期与浮层一起收掉
    hideTip()
  })

  // relatedTarget 为空 = 指针离开了窗口（去点别的应用）。这一下不会派发 pointerover，
  // 没有它的话浮层会一直挂在屏幕上
  document.addEventListener('pointerout', (event) => {
    if (event.relatedTarget === null) hideTip()
  })

  // 按下鼠标意味着接下来大概率是「界面要变了」（点了按钮、开了菜单），
  // 而元素挪走后浮层留在原地就是错的。收掉比跟踪位置省事得多
  document.addEventListener('pointerdown', hideTip, true)

  // 滚动会让被提示元素从浮层底下挪走；窗口尺寸变化、失去焦点同理。都直接收掉最省事，
  // 也不用去跟踪那些位置。
  window.addEventListener('scroll', hideTip, true)
  window.addEventListener('resize', hideTip)
  window.addEventListener('blur', hideTip)
}

export function TooltipHost(): React.JSX.Element | null {
  const text = useTooltip((state) => state.text)
  const rect = useTooltip((state) => state.rect)
  const anchor = useTooltip((state) => state.anchor)
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => bindGlobalListeners(), [])

  /**
   * 先挂载再定位：框有多宽只有渲染出来才知道，先按左边缘算的话，
   * 右侧放不下时会在真实位置与初算位置之间闪一下。layout effect 里量完改位置，
   * 发生在浏览器绘制之前，所以看不到这一闪。
   */
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !rect) return
    const width = element.offsetWidth
    const height = element.offsetHeight
    // 默认落在被提示元素的右侧（与折叠侧栏的图标名一致）；右边放不下就翻到左侧
    let left = rect.right + GAP
    if (left + width > window.innerWidth - MARGIN) left = rect.left - GAP - width
    // 两侧都放不下（元素又宽又贴边）就夹进视口，宁可压着元素也不要跑出屏幕
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - MARGIN - width))
    // 垂直方向对齐元素中心，同样夹进视口
    const top = Math.min(
      Math.max(MARGIN, rect.top + rect.height / 2 - height / 2),
      Math.max(MARGIN, window.innerHeight - MARGIN - height)
    )
    setPos({ left, top })
  }, [rect, text])

  /**
   * 浮层只该在指针仍停在被提示元素上时存在。
   *
   * ★ 光有 pointerout 不够，原因是「leave 不一定会来」：
   *   1. 布局一变（窗口变宽触发的侧栏自动展开）元素就从指针底下挪走了，这不派发 out；
   *   2. 指针停在 disabled 控件上时事件目标是它的父节点，拿 target 判包含关系会误判。
   *   所以再加一道与「有没有 out」无关的兜底：按坐标算指针在不在锚点里，不在就收。
   */
  useEffect(() => {
    if (!anchor) return
    const onPointerMove = (event: PointerEvent): void => {
      if (!anchor.isConnected) return hideTip()
      if (event.target instanceof Node && anchor.contains(event.target)) return
      const underPointer = document.elementFromPoint(event.clientX, event.clientY)
      if (underPointer && anchor.contains(underPointer)) return
      hideTip()
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [anchor])

  if (!text) return null
  // aria-hidden：这一层纯粹是补视觉。名字该由元素自己的 aria-label 承担
  // （转换前挂在 title 上的那批，都补了 aria-label）
  return (
    <div
      ref={ref}
      className="tip"
      aria-hidden="true"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {text}
    </div>
  )
}

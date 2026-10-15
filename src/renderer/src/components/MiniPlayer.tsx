/**
 * 迷你播放器界面：一条紧凑播放条，外加一块可展开、可拖高的面板（歌词或播放队列）。
 *
 * ★ 它跑在**自己的窗口**里（不是主界面缩小出来的那一态，见 main/mini-window.ts）。
 *
 * ★★ 这棵树从上到下是三段：**播放条（永远 64px）/ 面板（展开时，用户拖出来的高度）/ 透明容器
 *   （吃掉剩下的一切）**。窗口高度 = 条 + 面板（主进程算，见 main/mini-window.ts 的 applyBounds），
 *   菜单开着时另有一档（MINI_MENU_HEIGHT，菜单是页面里的 DOM，画不出窗口）；而**多出来的余量**
 *   （系统事件把窗口拉成半屏 / 全屏、窗口管理器自作主张）全落在透明容器里 —— 条与面板的尺寸
 *   一个像素都不跟着变。这三段的尺寸各自钉死，所以那一格里的东西不会因为窗口变大而变形
 *   （见样式表 .mini-player）。
 *
 * ★ 它读的 `usePlayer` 按窗口角色分流（见 state/usePlayer）：
 *   · 普通迷你窗（跟随者）拿到的**主窗口那份的镜像**（state/remotePlayer.ts）—— 数据由主窗口
 *     推来，动作（播放 / 切歌 / 跳转 / 音量 / 队列增删改）变成遥控命令发回去；
 *   · 本地文件会话里的迷你窗（宿主）拿到的**就是播放器本身**（state/player-core.ts）——
 *     动作当场就落在自己那个 <audio> 上。
 *   同一棵树、同一套组件，界面一个分支都不必分。**同一首歌永远只有一个 <audio> 在放**：
 *   分流保证了一个窗口要么是宿主、要么是跟随者。
 *
 * ── 条上有什么（从左到右）────────────────────────────────────────────────
 *   · 封面：贴左缘的全高方块，**拖窗口的把手**之一（条整体都是把手区，见样式表 .mini-bar）：
 *     按住封面即拖窗口。代价写在样式表 .mini-cover 那一节：这一格在 Wayland / Windows 上收不到
 *     指针事件 —— 页面里的悬浮与右键都到不了它；它也不在那条交互带里（带只到它的右缘）。
 *     ★ 右键封面**不开应用菜单**：拖拽区就是非客户区，右键由**系统**弹窗口菜单（Electron 文档
 *       那条：可拖拽区的右键会弹系统菜单）—— 比自绘一张更对。旋钮因此只剩右上角那颗下拉钮。
 *   · 中栏：两行 —— 第一行歌名，第二行「歌手（可滚动）+ 播放时间/时长」。时间**钉在右端**，
 *     歌手再长也挤不到它（见样式表 .mini-info-sub）。
 *     **鼠标落在条上那条交互带时中栏换成控制**（音量 / 播放模式 / 收藏）：这三样都要占地方，
 *     常态挂着会一直挤着歌名，而它们又不是「看播放器」时时刻要盯的东西。
 *     ★ 判据是**那条带自己的框** —— 中栏与右侧控件组那一行：**带上下的空带不算**，封面与右上角
 *       那两颗窗口钮不算，**面板**（歌词 / 队列）也不算（指着面板时中栏保持歌名那两行，不冒按钮）。
 *       范围与理由见样式表 .mini-info-hover 那一段。
 *     ★ 这份判据就是 CSS 的 `:hover`，**不再由 JS 维护** —— 带整块是放行面，指针在它里外、
 *       跨它的边界，浏览器都算得准。从前要 JS 是因为判据写在整窗上、而封面那一格收不到事件
 *       （见样式表那一段的历史）。
 *   ★ 中栏与右边那一组控件**同属一个元素**（.mini-stage，样式表里管它叫「交互带」）：一块从
 *     封面右缘直通窗口右缘、**只有那一行那么高**的矩形（带上下的空带在它框外，不算，见样式表
 *     那一节）。**它同时是条上那个「能操作的洞」** —— 条整体是拖拽区（非客户区），这一块是
 *     唯一被挖回来的大面（no-drag），「悬浮换层 / 点钮」两件事都只在这一行里成立。
 *   · 控件：上一首 / 播放 / 下一首 / 歌词 / 队列。比底栏那套小一档（见 .mini-bar 的
 *     --mini-ctl-h），因为这一条总共只有 64px 高。
 *     ★ 这一组是放行面（样式表 .mini-controls）：它收得到事件（悬浮换层、点钮）而**不拖窗口**。
 *       右键一律**不开应用菜单** —— 与落在中栏两行 / 钮间那几条 2px 缝 / 进度线 / 窗口钮间那道
 *       缝上一样，由条上那句否决统一处理（见 suppressContextMenu）。
 *   · 右上角：**显示设置那颗 + 关闭**。**没有「退出迷你模式」** —— 那颗钮的语义（把窗口换回
 *     原样）在独立窗口下不存在了：迷你窗关掉就是关掉，主窗口一直好好的。最小化那颗也已去掉：
 *     迷你窗的用处正是「一直摆在那儿」，缩进任务栏就等于看不见了（系统那一侧的最小化仍在，
 *     从底栏那颗按钮或托盘再点一下就唤回来，见 main/mini-window.ts 的 openMiniWindow）。
 *     ★ 那颗钮（从右数第二个）开出来的就是**共享的那份菜单**（components/ContextMenu，全条唯一
 *       入口）：四根滑块 —— 整窗浓度，歌词 / 队列**两块面板各自**的浓度，加**歌词字号**（常驻
 *       四行，理由见下面 displayMenu）。它长在窗口
 *       **内部**、条下面那块透明容器让出来的地方 —— HTML 画不出窗口之外，而 Wayland 下又没法给
 *       新建的弹窗定位，所以菜单要地方，只能是窗口自己让出一段（加高的是窗口，不是播放器，
 *       见 shared/ipc.ts 的 MINI_MENU_HEIGHT）。
 *
 * ★ 无边框窗口没有系统标题栏：把手得自己给 —— **条整体**（`-webkit-app-region: drag` 写在
 *   .mini-bar 上）与**透明容器**都是把手，条上要能操作的地方各自挖回来（见样式表那份「拖拽区
 *   四项 + 放行面三项」的总表）。顺带白拿一件事：拖拽区的右键由**系统**弹窗口菜单 —— 那正是
 *   无边框窗口本来缺的那一份。
 *   关闭这一颗也得自己给 —— 少了它就是「这个窗关不掉」。
 *
 * ★ 面板高度可拖（把手压在窗口下边缘，见 .mini-resize）：窗口只会**向下**长，所以默认位置
 *   在工作区上方（见 main/mini-window.ts）；拖出来的高度落盘 —— 歌词与队列**各记一份**
 *   （settings.miniLyricsPanelHeight / miniQueuePanelHeight），于是两块可以不一样高：
 *   拖歌词那根把手只改歌词那一份，切到队列时用的是队列自己那一份（见 ResizeHandle）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  MINI_BAR_HEIGHT,
  MINI_LYRIC_FONT_SIZE_MAX,
  MINI_LYRIC_FONT_SIZE_MIN,
  MINI_PANEL_MIN_HEIGHT,
  MINI_SHADOW_EDGE,
  type MiniPanel
} from '@shared/ipc'
import {
  IconChevronDown,
  IconClose,
  IconHeart,
  IconLyrics,
  IconPause,
  IconPlay,
  IconQueue,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeX
} from './Icons'
import { useContextMenu, type MenuItem } from './ContextMenu'
import { LyricsView } from './LyricsView'
import { Queue } from './Panel'
import { MODE_LABEL, modeIcon } from './play-mode'
import { PlayerProgress } from './PlayerProgress'
import { Cover, Slider } from './primitives'
import { fallbackTitle, songCoverUrl } from '@shared/metadata'
import { useUnfocusable } from '@/hooks/useUnfocusable'
import { displayArtist, formatDuration } from '@/lib/format'
import { isMiniHost } from '@/lib/window-role'
import { usePlayer } from '@/state/usePlayer'
import { selectPanelHeight, useMiniView } from '@/state/useMiniView'
import { useSettings } from '@/state/useSettings'

/** 条上这几颗控件的图标尺寸（比底栏那套小一档，见 components.css 的 --mini-ctl-h） */
const ICON_CTL = 16
const ICON_NAV = 17

/**
 * 条上的右键一律**否决**：不弹应用菜单，也不放行 Chromium 那份默认菜单。
 *
 * ★ 本组件的自定义菜单（那几根显示滑块）**只有一个入口** —— 右上角从右数第二个按钮（那颗
 *   .win-btn，见下面 .mini-window-actions 那一段）。条上其余任何落点都不开菜单。
 * ★ 挂在**整条**（.mini-bar）上，不是挂在交互带上：条上收得到页面事件的地方不止带子一处（还有
 *   进度线与右上角那颗钮那一组，见样式表那份总表），挂带上的话那两处就得各自再写一遍。一处否决
 *   整条，将来给条加新的放行面也不会漏出一块「右键弹出默认菜单」的死角。
 * ★ 挂在条上**不会**碰到拖拽区：空带 / 封面 / 透明容器是非客户区，它们的 contextmenu 压根不产生
 *   页面事件，由**系统**弹窗口菜单（Electron 文档那条）—— 那是需求要的效果，不是被这里拦掉。
 * ★ 从前这里是一份「按落点分派」的函数（落在控件上掐掉，其余开应用菜单），已经删掉：条上不再有
 *   任何一处开应用菜单，分派也就无事可分 —— 剩下的唯一动作就是否决。
 *   `event.stopPropagation()` 留着是防上层：将来谁在 .mini-surface / .mini-player 上挂菜单宿主，
 *   不会顺着冒泡漏进条里来。
 */
const suppressContextMenu = (event: React.MouseEvent<HTMLElement>): void => {
  event.preventDefault()
  event.stopPropagation()
}

export function MiniPlayer(): React.JSX.Element {
  /** 宿主身份（本地文件会话里的迷你窗）：决定条上冒出哪几颗钮，见下面收藏那一段 */
  const host = isMiniHost()
  const player = usePlayer()
  /** 下方那块面板装什么（null = 收起）。★ 这份状态在 useMiniView 上，见那里的说明 */
  const panel = useMiniView((s) => s.panel)
  /**
   * 面板高度：写进行内样式（布局是「条 / 面板 / 透明容器」，面板得是固定尺寸那一项）。
   * ★ 取的是**当前那一块**的高度（两块各记一份，见 useMiniView 的 selectPanelHeight）——
   *   切面板时这里跟着换，窗口高度也跟着换（MiniApp 把它报给主进程）。
   */
  const panelHeight = useMiniView(selectPanelHeight)
  const togglePanel = useMiniView((s) => s.togglePanel)
  /** 当前曲目收没收藏：收藏表在主窗口那边，这里是镜像来的（见 state/remotePlayer.ts） */
  const favorite = useMiniView((s) => s.favorite)
  const miniOpacity = useSettings((s) => s.settings.miniWindowOpacity)
  /* 两块面板各自的浓度：菜单里那一行只给**开着的那一块**用，所以两个值都得在手边 */
  const lyricsPanelOpacity = useSettings((s) => s.settings.miniLyricsPanelOpacity)
  const queuePanelOpacity = useSettings((s) => s.settings.miniQueuePanelOpacity)
  /**
   * 歌词字号：**这一块面板自己**那个量（还没拖过时是 15，正是它此前写死的字号）。
   * ★ 不是设置页「歌词」那一栏的 lyricFontSize —— 那两个量刻意分开，见 shared/ipc.ts。
   */
  const miniLyricFontSize = useSettings((s) => s.settings.miniLyricFontSize)
  const patchSettings = useSettings((s) => s.patch)
  /** 那颗下拉钮（右上角从右数第二个）。既是菜单的入口，也是「再点一次收起」的判据（见 menuOpen） */
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  /**
   * 这一份菜单开着没有。**本组件之外**那件事（窗口临时加高到放得下菜单）由 MiniApp 报给主进程，
   * 这里只用它给那颗钮一个 aria-expanded。
   *
   * ★ 连 anchor 一起认（与 SettingSelect / TitleBar 同一口径）：菜单宿主是**全窗共用**的一份，而
   *   迷你窗里还有第二个来源 —— 队列里右键某首歌（Panel.tsx 走 openMenuFromEvent，那份不带
   *   anchor）。只认 `s.open` 的话，那个菜单开着时这颗钮会谎报 aria-expanded=true。
   * ★ 也不另存一份「我开着」的本地 state：宿主的 anchor 就是那份事实，抄一份只会多一个会漂的副本。
   */
  const menuOpen = useContextMenu((s) => s.open && s.anchor === menuBtnRef.current)
  /**
   * 整棵迷你树**不接受焦点**（Tab、鼠标、程序化三条路都堵掉 —— 见 hooks/useUnfocusable）。
   *
   * ★ 迷你条是浮在别的应用旁边的挂件：在它上面点一下（静音 / 切歌 / 拖音量）是想操作播放，
   *   不该把键盘焦点从主窗口抢走，也不该在挂件上出现一圈焦点环。
   * ★ 挂在整个 .mini-player 上：条、面板都在它里面，一处覆盖全部（含共享组件里那些按钮与
   *   滑条，它们不归这一层管，也就无从逐个改）。菜单不算 —— 它是共享的那份宿主，挂在
   *   .mini-player **外面**（见 MiniApp）。
   */
  const rootRef = useUnfocusable<HTMLDivElement>()
  /** 拖动进度条时手上的位置（null = 没在拖），与底栏同一套语义 */
  const [scrub, setScrub] = useState<number | null>(null)
  const song = useMemo(
    () =>
      player.cursor >= 0 && player.cursor < player.order.length
        ? player.queue[player.order[player.cursor]]
        : null,
    [player.cursor, player.order, player.queue]
  )

  const duration = player.duration || song?.duration || 0
  const position = scrub ?? player.currentTime

  /**
   * 迷你窗的显示设置菜单：**四根滑块** —— 「播放器不透明度」「歌词面板不透明度」「队列面板不
   * 透明度」「歌词字号」。**全条唯一的入口是右上角从右数第二个按钮**（那颗 .win-btn）—— 交互带
   * 的右键已撤、封面右键让给系统，条上别处一律不开应用菜单（见 suppressContextMenu）。
   *
   * ★ 封面右键不再开这一份：拖拽区（= 非客户区）的右键由**系统**弹窗口菜单（Electron 文档那条），
   *   滑块改由按钮独占。挂在按钮上本来也是最稳的那条路 —— 它在窗口钮组里、整组标着 no-drag，
   *   一定收得到。
   * ★★ 四根**常驻**：面板开没开、开着哪一块，菜单都是这四行。理由有两条 ——
   *   ① 菜单里少一行多一行是**看得见**的（内容一变，窗口高度也跟着变一次），而这几根滑块本来就是
   *      「随时可能想调」的东西，不该要人先把对的那块面板开出来才找得到；
   *   ② 两块面板的浓度是**各存一份**的（见 shared/ipc.ts），标题里把「哪一块」写清，比按当前
   *      面板换标题更不容易看错。
   *   ★ 代价：MINI_MENU_HEIGHT 是按**四行**重算的（见 shared/ipc.ts 那一段）—— 菜单里再加减内容，
   *     要回去核那一档，否则菜单会被窗口下边缘裁掉或被迫出滚动条。
   * ★ 两根面板滑块调的都是**那一块自己**的浓度：拖「歌词面板」那根，队列那份一个像素都不动。
   *   面板收起时拖它照样生效（下次展开就是那个浓度）。
   * ★ 底色是**相对播放条**（--mini-tint）的浓度，100 = 与条一致 —— 深浅两个主题下都说得通，
   *   不必分两套默认值；它顺带牵动**窗口那圈阴影**（面板调淡时，围着「条 + 面板」那一圈跟着淡出、
   *   围着播放条自己那一圈按互补比例淡入，见样式表 .mini-surface 与 .mini-player::before），
   *   这里不必额外做什么。
   * ★★ 歌词字号那一根管的是**这一块面板自己**的字号（miniLyricFontSize），与设置页「歌词」那一栏
   *   的 lyricFontSize **是两个量**：整窗尺度上的抽屉/满窗与挂在屏幕角上、只有 380px 宽的挂件，
   *   合适字号本来就差着一档。共用的话只会「调好抽屉、迷你窗糊成一片」（见 shared/ipc.ts 那两项
   *   上的说明）。上下限也是它自己那一档（12–30），比主窗口那条低 —— 理由同样在这一块只有这么宽。
   *   ★ 面板关着时拖它照样生效（下次展开就是新字号）：菜单是「想调什么就在哪儿」，而字号正是那种
   *     「看一眼觉得小了、当场拖一下」的量（与那两根面板浓度同理）。
   *   ★ 它落在行内（.lyrics 的 font-size）上，而样式表里 .lyric-line 有一条写死的 px ——
   *     迷你窗那一条 html[data-mini] 规则专门为它放开了继承，见 components.css 那两处。
   * ★ 做成**函数**而不是模块级常量：四个 value 与 onChange 要取「点开这一刻」的设置值，
   *   常量数组会把它们钉死在首次渲染那一份上。
   */
  const displayMenu = (): MenuItem[] => [
    {
      key: 'mini-opacity',
      label: '播放器不透明度',
      slider: {
        min: 0,
        max: 100,
        value: miniOpacity,
        onChange: (value) => void patchSettings({ miniWindowOpacity: value })
      }
    },
    {
      key: 'mini-lyrics-panel-opacity',
      label: '歌词面板不透明度',
      slider: {
        min: 0,
        max: 100,
        value: lyricsPanelOpacity,
        onChange: (value) => void patchSettings({ miniLyricsPanelOpacity: value })
      }
    },
    {
      key: 'mini-queue-panel-opacity',
      label: '队列面板不透明度',
      slider: {
        min: 0,
        max: 100,
        value: queuePanelOpacity,
        onChange: (value) => void patchSettings({ miniQueuePanelOpacity: value })
      }
    },
    {
      key: 'mini-lyric-font-size',
      label: '歌词字号',
      slider: {
        min: MINI_LYRIC_FONT_SIZE_MIN,
        max: MINI_LYRIC_FONT_SIZE_MAX,
        value: miniLyricFontSize,
        // 单位是 px —— 菜单里那个后缀默认是 %
        suffix: 'px',
        onChange: (value) => void patchSettings({ miniLyricFontSize: value })
      }
    }
  ]

  /**
   * 点那颗钮：**开着就收起，关着就展开**。
   *
   * ★ 收起这一半只能由这里给：菜单宿主那条「点别处就关」的监听挂在 window **捕获阶段**，
   *   按下去的一瞬间就该关掉菜单 —— 它刻意把触发器自己（anchor）放行，以免「刚关又被 onClick
   *   打开」看起来像点不掉（见 ContextMenu 的 onPointerDown）。放行之后，「再点一次」到底是
   *   收起还是重新展开，宿主不再管，判断权交回按钮 —— 也就是这个函数。
   * ★ 读 `getState()` 而不是读 menuOpen 那个布尔量：后者是**渲染那一刻**的快照，而收起与展开
   *   之间隔着一次窗口尺寸变化（主进程为放下菜单把迷你窗临时加高，见 shared/ipc.ts 的
   *   MINI_MENU_HEIGHT），重渲染不一定赶得上这一次点击。与 SettingSelect 同款。
   * ★ 判据要写成 `open && anchor === 这一颗`，不能只写 `open`：迷你窗里队列歌曲的右键菜单是
   *   第二个来源（不带 anchor）。它开着时点这颗钮应当是**换一份菜单**，而不是把别人的收掉 ——
   *   那种情况下宿主的捕获监听已经先把那份关掉了（点的是别处），这里读到 false，自然走展开分支。
   */
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const menu = useContextMenu.getState()
    if (menu.open && menu.anchor === event.currentTarget) {
      menu.hide()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    // 右对齐：触发器就贴着窗口右缘，左对齐会让面板整块探到窗外去
    menu.show(rect.left, rect.bottom + 6, displayMenu(), {
      anchor: event.currentTarget,
      align: 'right',
      anchorRect: rect
    })
  }

  return (
    /* 根上**不挂任何指针判据**：换层由 CSS 认那条交互带，右键由条上那句否决统一处理（见
       suppressContextMenu），根这一层只管把整棵树收进来（含 useUnfocusable）。
       ★ 条上留白处（控件行上下的那两条空带）、封面、透明容器是**拖拽区**，它们的右键归**系统**
         窗口菜单（见样式表 .mini-bar 那段「两种口径」）—— 与这一棵树无关，所以这里没有对应代码。 */
    /* data-panel 报「此刻开着的是哪一块面板」：面板那层底色、以及窗口那圈阴影的两个权重，都要按
       它挑一份出来（见样式表 .mini-player 那一段）。收起时**不带**这个属性 —— CSS 里那一档是
       「没有面板」，取满浓度。
       ★ 它只影响样式：布局与窗口高度不归它管（那些走 MiniWindowLayout 报给主进程）。 */
    <div className="mini-player" ref={rootRef} data-panel={panel ?? undefined}>
      {/*
        ★★ 内容层（播放条 + 面板）：**窗口阴影画在这一层的框上**，不画在 .mini-player 上。
          后者撑满整窗 —— 菜单开着、或系统事件（平铺 / 全屏）把窗口拉大时，多出来的那一段也
          含在它里面。阴影画在它身上，描的就是「一块透明地方」的边：菜单一开，那圈阴影跟着
          长到菜单底下那片空地上去了。
        ★ 条与面板收进**同一层**而不是各自画一份阴影：各画各的，接缝两侧就会各出一条阴影
          （面板上方一条、播放条下方一条），叠在一起正是最难看的「错位阴影」；收进一层之后
          接缝落在框内，那里天然没有阴影（见样式表 .mini-surface）。
      */}
      <div className="mini-surface">
        <footer className="mini-bar" onContextMenu={suppressContextMenu}>
          {/*
          封面：包一层是为了给它一个「接事件的容器」—— Cover 自己只认展示用的 props。
          ★★ 这一层是**拖窗口的把手**之一（条整体也是把手区，见样式表 .mini-bar）：按住封面即
            拖窗口。它因此**收不到指针事件** —— 指针落在上面时中栏保持原样（不换层）。
            它也不在交互带里：带只到它的右缘为止（见 .mini-stage）。
          ★ 右键**这里什么都不挂**：封面是拖拽区 = 非客户区，右键由**系统**弹窗口菜单（Electron
            文档那条：可拖拽区的右键会弹系统菜单）。事件到不了页面，也就轮不到条上那句否决。
          尺寸直接取 CSS 那条 --mini-bar-h（不在这儿另写一份数值），圆角给 0：贴着窗口
          边缘的圆角块看着像没对齐。width 是向后端要的缩略宽度（?w=），按显示尺寸的两倍给。
        */}
          <div className="mini-cover">
            <Cover
              coverUrl={songCoverUrl(song)}
              width={128}
              size="var(--mini-bar-h)"
              radius={0}
              kind="song"
            />
          </div>

          {/*
          交互带：**中栏与右侧控件组合起来的一整块矩形** —— 从封面右缘直通窗口右缘、**只有那一行
          那么高**（上下空带落在它框外，不算）。样式表见 .mini-stage，那里写的是「为什么它必须是
          一个元素」与「为什么高度是这一行、不是整条」。
          ★★ 它是条上那个**能操作的洞**：条整体是拖拽区（非客户区，见样式表 .mini-bar），这一块
            标着 no-drag 被挖回来 —— 于是上下那两条空带留在拖拽区里，拿到「按住能拖窗口 + 右键
            出系统菜单」，而这一行拿到「悬浮换层 + 点钮」。
          ★ 它自己不排版、也不许排版：包起来之后「指针落在这一整块里」第一次是一个**元素的事实**
            —— 判据（`:hover`）挂在它身上，内部那几道缝（控件组里那几条 2px）自然跟着算。
          ★ 这一层**不标底色**：它没有自己的背景，所以这一行看起来就是条本身（见样式表那一节）。
            画一层悬浮底会与条 / 封面 / 面板的合成色对不上，出现一块色差。
          ★ 这一层上**不挂任何 handler**：换层判据是 CSS 的 `:hover`（挂在它的框上，见样式表
            .mini-info-hover），右键由条上那句否决统一处理（见 suppressContextMenu，它挂在整条上，
            本层不开菜单）。于是「这一块是哪儿」只有一个出处 —— 这一层的框，不会与某处 handler
            的范围对不上。
        */}
          <div className="mini-stage">
            {/*
            中栏：文本两行 + 悬浮时盖在上面的控制条（两层都在 .mini-info 里，见样式表）。
            ★ 常态那两行各有各的滚动（ScrollingLine）：谁放不下谁滚，另外一行不动。
            ★ key 取歌曲 id：换歌要**从头**滚起（重挂一次 DOM = 动画重来），不然新歌一上来
              就接在上一首滚到一半的位置上。
          */}
            <div className="mini-info">
              <div className="mini-info-text">
                <ScrollingLine
                  key={`title-${song?.id ?? 0}`}
                  className="playerbar-title"
                  text={fallbackTitle(song)}
                />
                <div className="mini-info-sub">
                  <ScrollingLine
                    key={`artist-${song?.id ?? 0}`}
                    className="playerbar-artist"
                    text={song ? displayArtist(song.artist) : ''}
                  />
                  {/* 时间不挂 key：它每秒都在变，重挂纯属浪费；它也永远放得下，不必滚 */}
                  <span className="mini-time">
                    {formatDuration(position)}/{formatDuration(duration)}
                  </span>
                </div>
              </div>

              <div className="mini-info-hover">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={player.muted ? '取消静音' : '静音'}
                  onClick={() => player.toggleMute()}
                >
                  {player.muted || player.volume === 0 ? (
                    <IconVolumeX size={ICON_CTL} />
                  ) : (
                    <IconVolume level={player.volume > 0.55 ? 2 : 1} size={ICON_CTL} />
                  )}
                </button>
                <Slider
                  ariaLabel="音量"
                  className="mini-volume"
                  value={player.muted ? 0 : player.volume * 100}
                  max={100}
                  // 与底栏那条音量条同一套：拖动期间只改内存，松手立刻 flush（避免拖完就关掉丢最后一次）
                  onChange={(value) => player.setVolume(value / 100)}
                  onCommit={(value) => {
                    player.setVolume(value / 100)
                    player.flushVolume()
                  }}
                />
                {/* 与底栏那颗同口径：模式由图标示意，不靠变色（见 PlayerBar.tsx 的说明） */}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={MODE_LABEL[player.playMode]}
                  onClick={() => player.cyclePlayMode()}
                >
                  {modeIcon(player.playMode, ICON_CTL)}
                </button>
                {/*
                  收藏走的是**后端**（收藏表在服务端那份歌单里）：本地文件会话（迷你宿主窗）
                  里没有会话、也没有主窗口能接这条遥控命令，所以那一趟里这颗钮整个不出现 ——
                  摆一颗点了没反应的钮比不摆更糟。收藏态本身也是主窗口喂过来的（useMiniView）。
                */}
                {host ? null : (
                  <button
                    type="button"
                    className="icon-btn"
                    data-active={favorite}
                    aria-label={favorite ? '取消收藏' : '收藏'}
                    disabled={!song}
                    onClick={() => void window.songloft.mini.command({ kind: 'toggle-favorite' })}
                  >
                    <IconHeart size={ICON_CTL} filled={favorite} />
                  </button>
                )}
              </div>
            </div>

            {/*
            右侧那一组控件（见样式表 .mini-controls）：**不拖窗口**。
            拖不了是结构上的 —— 它在交互带里，而带整块是放行面（no-drag），按下的事件进页面、
            由钮自己接手。
            ★ 这里**什么都不挂**，右键也一样：条上那句否决（见 suppressContextMenu，挂在整条上）
              把这一组连同钮间那几条 2px 缝一起管掉了 —— 一处口径，不必在每颗钮上再写一遍。
          */}
            <div className="mini-controls">
              <button
                type="button"
                className="icon-btn"
                aria-label="上一首"
                disabled={!song}
                onClick={() => void player.previous()}
              >
                <IconSkipBack size={ICON_NAV} />
              </button>
              <button
                type="button"
                className="play-btn"
                aria-label={player.playing ? '暂停' : '播放'}
                disabled={!song}
                onClick={() => void player.toggle()}
              >
                {/*
                两颗图标尺寸刻意不同：三角形那个字形本身只占方框的四成宽，而**面积**只有它
                外接矩形的一半（暂停那两根竖条是实打实的满框），同一个 size 下三角形看着就是
                小一号。所以播放给 14、暂停给 12 —— 切换时才不会像「图标突然缩了一截」。
              */}
                {player.playing ? <IconPause size={12} /> : <IconPlay size={14} />}
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="下一首"
                disabled={!song}
                onClick={() => void player.next(false)}
              >
                <IconSkipForward size={ICON_NAV} />
              </button>

              <button
                type="button"
                className="icon-btn"
                data-active={panel === 'lyrics'}
                aria-label={panel === 'lyrics' ? '收起歌词' : '歌词'}
                onClick={() => togglePanel('lyrics')}
              >
                <IconLyrics size={ICON_CTL} />
              </button>
              {/* 队列与歌词共用下面那一块面板，所以两颗钮互斥：点另一颗是**换内容**，不是叠一层 */}
              <button
                type="button"
                className="icon-btn"
                data-active={panel === 'queue'}
                aria-label={panel === 'queue' ? '收起播放队列' : '播放队列'}
                onClick={() => togglePanel('queue')}
              >
                <IconQueue size={ICON_CTL} />
              </button>
            </div>
          </div>

          {/*
          右上角那一组：下拉菜单 + 关闭（关闭那颗与主窗口标题栏右端同款 .win-btn，只是小一档）。
          ★ 下拉那颗（从右数第二个）是那份菜单**全条唯一的入口** —— 条上别处一律不开应用菜单
            （见 suppressContextMenu）：封面右键让给了系统窗口菜单，交互带也不再开自绘菜单。
            这一组在样式表里整组标着 no-drag（见 .mini-window-actions），所以两颗钮都点得动。
          ★ 它是个**开关**：开着时再点一次收起（见 toggleMenu）。收起逻辑必须由按钮自己给
            —— 宿主那条「点别处关」的捕获监听刻意放行触发器，判断权交回按钮。
          ★ 原先这里还有一颗最小化，已去掉 —— 理由见文件头那一段（系统那一侧的最小化还在，
            从底栏那颗按钮或托盘再点一下就唤回来）。
          它们整个落在控件行上方那条空带里（高度由 CSS 按条高与控件高算出来），所以那条带
          有多高，这里的图标就只能是多大 —— 11px 是它能舒服放下的上限。
          ★ 代价：这一小块（两颗钮 + 钮间那道缝）从拖拽区里挖走了 —— 它上下左右那一圈空带仍然
            能拖窗口、右键仍出系统菜单，只有钮自己这一格不行。
        */}
          <div className="mini-window-actions">
            <button
              ref={menuBtnRef}
              type="button"
              className="win-btn"
              /* 标签是「显示设置」而不是「不透明度」：那份菜单里除了三根浓度滑块，还有歌词字号
                 —— 叫「不透明度」会让最后那一行看着像放错了地方（e2e 也点名断言这一颗的文案，
                 见 scripts/e2e/drive.mjs 的 miniWinButtons）。 */
              aria-label="显示设置"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              <IconChevronDown size={11} />
            </button>
            <button
              type="button"
              className="win-btn"
              data-variant="close"
              aria-label="关闭"
              onClick={() => void window.songloft.window.close()}
            >
              <IconClose size={11} />
            </button>
          </div>

          {/*
          进度线：贴条的下边缘、横跨整条（含封面那一段）。

          ★★ 它**必须是条里最后一个子元素**，别按视觉顺序挪到前面去 —— 这一条不是排版偏好，是
            输入区归属的决定因素。条整体标着 drag（见样式表 .mini-bar），进度线靠 no-drag 被挖
            回来；而 Blink 收集这些矩形时走的是 **LayoutObject 树的先后顺序**（父先于子、子按
            DOM 序，`SlowFirstChild()/NextSibling()`）**而不是 z-index**，Electron 侧再按这个
            列表逐条 add / subtract —— 于是「同一个像素上，谁在 DOM 里靠后，谁的值说了算」。
            排在封面后面，它挖的那一格才真的挖得动（封面那一段也才拖得了播放头）；排在前面时，
            封面（drag）后处理会把那一段重新盖回去 —— 表现就是「线明明画在封面上、指针却按不动」。
            ⚠️ z-index 管的是**画面**，管不了**输入区**。两者在这一个元素上是两个独立机制，
              别指望其中一个能替另一个干活（见样式表那一节的说明）。
          ★ 它是 absolute 定位，所以排在最前还是最后**不影响布局**：条还是那个 flex 行，
            封面 / 交互带 / 窗口钮的占位一个像素都不动。
          ★ 命中带比看得见的那条线高（样式表：盒 10px、可见 3px→5px）：3px 的细线要「轻松」压住
            不容易，手稍偏一点就滑到封面上、变成拖窗口了。加高之后封面底部那一小条也归它管，
            从封面那一段按下并横向拖动照样能拖播放头（按下即 setPointerCapture，见下面这个组件）。
        */}
          <PlayerProgress
            duration={duration}
            position={player.currentTime}
            scrub={scrub}
            onScrub={setScrub}
            onSeek={(seconds) => player.seek(seconds)}
            onSeekBy={(delta) => player.seekBy(delta)}
          />
        </footer>

        {/*
        展开时才挂面板，且挂在播放条**之后**（它在进度线下方）。窗口高度是主进程一步到位的
        （原生窗口的尺寸做不了动画），内容这边补一段**自顶向下拉出来**的展开，看着才不像
        「啪」地一下多出一块 —— 展开方向是刻意的，见样式表 @keyframes mini-panel-in。

        ★ 歌词与队列共用这一格地方（同一时刻只有一块）。**两块各有各的高度**（见 useMiniView）：
          换内容会换高度、窗口跟着主进程重摆一次；同一块里开合（点两次同一颗钮）才是不动窗口的
          那一路 —— 主进程那边收到的仍是「开没开 + 此刻这一块多高」两个量（见 MiniWindowLayout）。
          队列那一份要自己给滚动容器（见 .mini-queue）—— 歌词那边是 LyricsView 里的 .lyrics
          自带 flex: 1 + overflow-y: auto。
        ★ 队列**不给右键菜单**（menu={false}）：那一份菜单里的动作（加入歌单、从曲库删除、
          查看歌手…）全都要主窗口的曲库与会话，迷你窗里没有它们 —— 菜单画得出来、点了没反应，
          比没有这个菜单更糟。
        ★★ 高度**写在行内**（不靠 CSS）：布局是「条 / 面板 / 透明容器」三段的弹性列，面板必须是
          固定尺寸的 flex 项 —— 否则窗口被系统事件拉高时，多出来的高度会落进面板里，用户拖出来
          的那个高度就不作数了（见样式表 .mini-player 那一段）。
      */}
        {panel ? (
          <div className="mini-panel" style={{ height: panelHeight }}>
            {panel === 'lyrics' ? (
              <LyricsView compact />
            ) : (
              <div className="mini-queue">
                {/* currentSlot = 2：当前曲固定落在**从上往下第 3 格**（上面留两行）。
                  面板最矮只有 180px，只保证「看得见」的话它会贴着下边缘、或干脆在视野之外。 */}
                <Queue currentSlot={2} menu={false} />
              </div>
            )}

            {/*
            面板高度的拖拽把手：压在**面板**的下边缘（见样式表 .mini-resize）。
            ★ 挂在面板**里面**（不再是面板后面的兄弟）：它要贴的是面板的下边缘，而窗口下边缘在
              「系统把窗口拉高」时并不等于面板下边缘（中间那段是透明容器）。
            ★ 位移按「相对按下那一刻」算，不是累加每次 move：窗口在拖的过程中一直在长，
              用增量算的话每一帧都在拿变化后的尺寸当基准，很快就飘了。
            ★ 松手才落盘（敲准**这一块**那一项：settings.miniLyricsPanelHeight 或
              miniQueuePanelHeight），拖动期间只改内存 —— 每个 pointermove 写一次配置就是几十次
              全量落盘，主进程会被拖住（与音量那套合并写同一个理由）。
            ★ 把 `panel` 传下去而不是让它自己去读：拖的时候改的就是**眼前这一块**，落盘也该落
              那一项 —— 两处各读一次状态的话，将来面板一多就会有一处落错键。
          */}
            <ResizeHandle panel={panel} />
          </div>
        ) : null}
      </div>

      {/*
        透明容器：窗口比「条 + 面板」多出来的那一部分全归它（系统事件把窗口拉成半屏 / 全屏时
        就是它顶着，菜单开着时它让出来的那一段就是菜单的地方），播放条与面板的尺寸一个像素都
        不跟着变。
        ★ 它是透明的（不铺任何底色）。落在它上面的鼠标按「拖窗口的把手」算 —— 与封面同一种
          手感：一块空地方，按下去就是把挂件挪个位置。
        ★ aria-hidden：它没有任何内容，读屏不该在里面停。
      */}
      <div className="mini-slack" aria-hidden="true" />
    </div>
  )
}

/**
 * 拖拽把手。
 *
 * 单独拎出来是因为它自己就是一小份状态（按下那一刻的位置与高度），与整条播放条无关 ——
 * 混在 MiniPlayer 里会让「换歌重渲染」与「拖动中的中间态」互相搅。
 *
 * ★ `panel` 是**它正拖着的那一块**（由 MiniPlayer 传下来，那边知道现在开着谁）：拖动本身只需
 *   改「当前高度」（store 自己认面板），但**落盘**要落到那一块的设置项上 —— 两块各记一份，
 *   拖歌词那根把手不该动到队列（见 shared/ipc.ts 的 miniLyricsPanelHeight）。
 */
function ResizeHandle({ panel }: { panel: MiniPanel }): React.JSX.Element {
  /** 拖动的基准是**这一块**此刻的高度（两块各记一份，见 selectPanelHeight） */
  const panelHeight = useMiniView(selectPanelHeight)
  const setPanelHeight = useMiniView((s) => s.setPanelHeight)
  const patchSettings = useSettings((s) => s.patch)
  /** 按下那一刻的指针位置与面板高度；null = 没在拖 */
  const drag = useRef<{ y: number; height: number } | null>(null)

  /**
   * 面板能拖多高：屏幕可用高度减去播放条与一点余量。
   *
   * 窗口只会**向下**长（位置不动），拖过屏幕下边缘的部分就看不见了 —— 所以上限不能只是
   * 「一个很大的数」，得以当前屏幕为准。主进程那边还有一道同样的钳制（工作区高度），
   * 两道都要：这里管的是「手上的感觉」不越界，那边管的是「窗口真的不越界」。
   * ★ 两块共用这一个上限（它只跟屏幕与播放条有关，与哪一块无关）。
   * ★ 减去的两项要与主进程算窗口高度时的一致：播放条那一档 + 窗口上下那两圈阴影边距
   *   （MINI_SHADOW_EDGE）。少减一边，拖到底时窗口会被主进程钳住、面板最下面一截被裁掉。
   */
  const maxHeight = Math.max(
    MINI_PANEL_MIN_HEIGHT,
    window.screen.availHeight - MINI_BAR_HEIGHT - MINI_SHADOW_EDGE * 2 - 24
  )

  const clamp = (height: number): number =>
    Math.min(Math.max(Math.round(height), MINI_PANEL_MIN_HEIGHT), maxHeight)

  return (
    <div
      className="mini-resize"
      role="separator"
      aria-label="拖动调整面板高度"
      aria-orientation="horizontal"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, height: panelHeight }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        // 向下拖 = 面板更高（把手压在窗口下边缘，窗口跟着向下长）
        setPanelHeight(clamp(current.height + (event.clientY - current.y)))
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        // 取 store 里**这一刻**的值（拖动期间改的就是它）：不写两处，免得与上面那几步算出两份
        const height = useMiniView.getState().heights[panel]
        void patchSettings(
          panel === 'queue' ? { miniQueuePanelHeight: height } : { miniLyricsPanelHeight: height }
        )
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    />
  )
}

/** 循环里两份文本之间的间隔（px）：太窄两遍读起来像连成了一句，太宽又白等 */
const LOOP_GAP = 48
/** 滚动的观感速度（px/s） */
const LOOP_SPEED = 40
/** keyframes 两头各留的停顿比例（须与 styles/components.css 的 mini-line-scroll 一致） */
const LOOP_DWELL = 0.14

/**
 * 迷你条上的一行文本：**放不下就循环滚动**（跑马灯那一套，不是来回蹭）。
 *
 * 歌名与歌手各是一个实例，各自量各自的宽度、各自决定滚不滚 —— 一行在滚不会让另一行动一下
 * （它们连动画都没挂）。
 *
 * ★ 「循环」= 文本连续两份首尾相接，动画只把整条往左推**一份**（含间隔）的距离，推到尽头时
 *   第二份的脑袋正好落在第一份原来的位置上 —— 于是画面与起点逐像素相同，接得严丝合缝。
 *   `animation-direction: alternate`（来回滚）做不到这一点：它滚到头会**倒着**退回去，
 *   读到一半的信息被倒放一遍，长标题尤其明显。
 * ★ 位移与时长由 JS 量、动画交给 CSS：速度得跟着**文本宽度**走 —— 长的该滚得久一点、
 *   短的三两下就到头；写死一个 animation-duration 的结果是「短的慢得发慌、长的还在挪」。
 *   量出来的值写成 CSS 变量，动画本身仍在样式表里（见 .mini-line-track）。
 * ★ 有两条前提，缺一条这套就静默失效：
 *   ① 外层 .mini-line 的宽度由外面定死（.mini-info-sub 里那一路是 `flex: 1 1 0` + min-width: 0），
 *      所以「量出来的溢出」是真实溢出，而不是被文本自己撑宽的假象；
 *   ② 内层 .mini-line-track 是 width: max-content，不会被外层剪窄 —— 否则量到的永远是 0，
 *      滚动就静默不触发了。
 * ★ 不溢出时**一个 data 属性、一份重复文本都不挂**：绝大多数时候这几行是静态的，常挂着
 *   animation 只是白烧电，重复的那份还会被读屏软件念第二遍。
 *   prefers-reduced-motion 由 base.css 那条全局规则兜住（时长压到 0.01ms 且只跑一次），
 *   那种情况下它停在行首，效果与「截断显示」等价。
 * ★ text 单独传、不直接收 children：effect 的依赖数组得看得见「文本变了」这件事，
 *   收成一个 ReactNode 就只能靠引用比较 —— 每次都不同，等于每帧重测。
 */
function ScrollingLine({
  text,
  className
}: {
  text: string
  /** 文本自己的样式（.playerbar-title / .playerbar-artist 那一套），行本身不带 */
  className: string
}): React.JSX.Element {
  const outerRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  /** 循环一周期要往左推的距离（一份文本宽 + 间隔）：0 = 这一行放得下，不滚 */
  const [loop, setLoop] = useState(0)

  useEffect(() => {
    const outer = outerRef.current
    const copy = copyRef.current
    if (!outer || !copy) return

    const measure = (): void => {
      const overflow = copy.offsetWidth - outer.clientWidth
      // 4px 以内当没溢出：为了几个像素一直晃，比截断还难看
      setLoop(overflow > 4 ? copy.offsetWidth + LOOP_GAP : 0)
    }
    measure()
    /* 窗口宽度、字号都会改这一行的可见宽度 —— 交给 ResizeObserver，不然「该滚的不滚、
       不该滚的一直晃」。文本变了则由下面那个依赖数组负责重测（可见宽度没变，观察器不会响）。
       注意观察的是外框而不是那一份文本：追加的第二份是它的兄弟，不会把外框撑大，
       所以这里量一次就收敛，不会「加了第二份 → 溢出变了 → 再量」地来回抖。 */
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="mini-line" ref={outerRef}>
      <div
        className="mini-line-track"
        data-scroll={loop > 0 ? 'true' : undefined}
        style={
          loop > 0
            ? ({
                gap: `${LOOP_GAP}px`,
                '--mini-line-shift': `-${loop}px`,
                // 两头各停 LOOP_DWELL，真正在走的只有剩下的那一段：
                // 想要 LOOP_SPEED 的观感，整周期就得按「走的时间占比」放大
                '--mini-line-dur': `${(loop / (LOOP_SPEED * (1 - 2 * LOOP_DWELL))).toFixed(2)}s`
              } as React.CSSProperties)
            : undefined
        }
      >
        <span className={`mini-line-copy ${className}`} ref={copyRef}>
          {text}
        </span>
        {/* 第二份只为「第一份走出去时」垫在后面。读屏软件不该把它念第二遍 */}
        {loop > 0 ? (
          <span className={`mini-line-copy ${className}`} aria-hidden="true">
            {text}
          </span>
        ) : null}
      </div>
    </div>
  )
}

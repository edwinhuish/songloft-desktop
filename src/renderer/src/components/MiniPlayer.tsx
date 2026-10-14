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
 * ★ 它读的 `usePlayer` 是**主窗口那份的镜像**（state/remotePlayer.ts）：数据由主窗口推来，
 *   动作（播放 / 切歌 / 跳转 / 音量 / 队列增删改）变成遥控命令发回去。播放的唯一事实源
 *   永远在主窗口 —— 两个窗口各放一份音频就是同一首歌响两遍。
 *
 * ── 条上有什么（从左到右）────────────────────────────────────────────────
 *   · 封面：贴左缘的全高方块，也是这一条上最好用的**拖窗口把手**（它在拖拽区里）。
 *     它身上不挂任何鼠标动作：那一格的事件整片被窗口系统收走，挂了也是死代码 ——
 *     窗口级的两个旋钮（播放器 / 面板背景不透明度）因此改挂右上角那颗钮，见下。
 *   · 中栏：两行 —— 第一行歌名，第二行「歌手（可滚动）+ 播放时间/时长」。时间**钉在右端**，
 *     歌手再长也挤不到它（见样式表 .mini-info-sub）。
 *     **鼠标落在迷你播放器上时中栏换成控制**（音量 / 播放模式 / 收藏）：这三样都要占地方，
 *     常态挂着会一直挤着歌名，而它们又不是「看播放器」时时刻要盯的东西。**整窗都算**（条 /
 *     面板 / 菜单 / 那块透明容器），见样式表 .mini-info-hover 那一段。
 *     ★ 但**能不能触发**还取决于中栏在不在条的 no-drag 名单里：它归拖拽区（是拖窗口的把手），
 *       那边吞掉的是「按下」——x11 上移动照旧送得到；Wayland 上连移动一起吞，指针得先经过某个
 *       no-drag 的点（那三颗按钮 / 音量滑条 / 控件行）才会换上来。
 *   · 控件：上一首 / 播放 / 下一首 / 歌词 / 队列。比底栏那套小一档（见 .mini-bar 的
 *     --mini-ctl-h），因为这一条总共只有 64px 高。
 *   · 右上角：**不透明度那颗 + 关闭**。**没有「退出迷你模式」** —— 那颗钮的语义（把窗口换回
 *     原样）在独立窗口下不存在了：迷你窗关掉就是关掉，主窗口一直好好的。最小化那颗也已去掉：
 *     迷你窗的用处正是「一直摆在那儿」，缩进任务栏就等于看不见了（系统那一侧的最小化仍在，
 *     从底栏那颗按钮或托盘再点一下就唤回来，见 main/mini-window.ts 的 openMiniWindow）。
 *     ★ 那颗钮开出来的就是**共享的那份菜单**（components/ContextMenu，两根滑块）：它长在窗口
 *       **内部**、条下面那块透明容器让出来的地方 —— HTML 画不出窗口之外，而 Wayland 下又没法给
 *       新建的弹窗定位，所以菜单要地方，只能是窗口自己让出一段（加高的是窗口，不是播放器，
 *       见 shared/ipc.ts 的 MINI_MENU_HEIGHT）。
 *
 * ★ 无边框窗口没有系统标题栏：拖拽区得自己给（整条都是拖拽区，控件逐个放行，见样式表），
 *   关闭这一颗也得自己给 —— 少了它就是「这个窗关不掉」。
 *
 * ★ 面板高度可拖（把手压在窗口下边缘，见 .mini-resize）：窗口只会**向下**长，所以默认位置
 *   在工作区上方（见 main/mini-window.ts）；拖出来的高度落盘到 settings.miniPanelHeight。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { MINI_BAR_HEIGHT, MINI_PANEL_MIN_HEIGHT, MINI_SHADOW_EDGE } from '@shared/ipc'
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
import { useUnfocusable } from '@/hooks/useUnfocusable'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { useMiniView } from '@/state/useMiniView'
import { useSettings } from '@/state/useSettings'

/** 条上这几颗控件的图标尺寸（比底栏那套小一档，见 components.css 的 --mini-ctl-h） */
const ICON_CTL = 16
const ICON_NAV = 17

export function MiniPlayer(): React.JSX.Element {
  const player = usePlayer()
  /** 下方那块面板装什么（null = 收起）。★ 这份状态在 useMiniView 上，见那里的说明 */
  const panel = useMiniView((s) => s.panel)
  /** 面板高度：写进行内样式（布局是「条 / 面板 / 透明容器」，面板得是固定尺寸那一项） */
  const panelHeight = useMiniView((s) => s.panelHeight)
  const togglePanel = useMiniView((s) => s.togglePanel)
  /** 当前曲目收没收藏：收藏表在主窗口那边，这里是镜像来的（见 state/remotePlayer.ts） */
  const favorite = useMiniView((s) => s.favorite)
  const miniOpacity = useSettings((s) => s.settings.miniWindowOpacity)
  const panelOpacity = useSettings((s) => s.settings.miniPanelOpacity)
  const patchSettings = useSettings((s) => s.patch)
  /**
   * 菜单开着没有。**本组件之外**那件事（窗口临时加高到放得下菜单）由 MiniApp 报给主进程，
   * 这里只用它给那颗钮一个 aria-expanded。
   */
  const menuOpen = useContextMenu((s) => s.open)
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
   * 右上角那颗下拉里的菜单：两个不透明度旋钮。
   *
   * ★ 这两项最早是**封面的右键菜单**，现在只挂在这颗钮上 —— 封面归了拖拽区之后，那一格上的
   *   鼠标事件整片都被窗口系统收走（不分左右键，见 styles/components.css 里那份 no-drag 名单
   *   的说明），右键根本到不了页面。挂在按钮上则不受影响：条上所有 button 都是 no-drag。
   * ★ 做成**函数**而不是模块级常量：两个 value 与 onChange 要取「点开这一刻」的设置值，
   *   常量数组会把它们钉死在首次渲染那一份上。
   */
  const opacityMenu = (): MenuItem[] => [
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
      key: 'mini-panel-opacity',
      /*
        面板那层底色是**相对播放条**的浓度（100 = 与条一致），见 tokens.css ——
        所以它在深浅两个主题下都说得通，不必分两套默认值。
      */
      label: '面板背景不透明度',
      slider: {
        min: 0,
        max: 100,
        value: panelOpacity,
        onChange: (value) => void patchSettings({ miniPanelOpacity: value })
      }
    }
  ]

  return (
    <div className="mini-player" ref={rootRef}>
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
        <footer className="mini-bar">
          <PlayerProgress
            duration={duration}
            position={player.currentTime}
            scrub={scrub}
            onScrub={setScrub}
            onSeek={(seconds) => player.seek(seconds)}
            onSeekBy={(delta) => player.seekBy(delta)}
          />

          {/*
          封面：包一层是为了给它一个「不接事件的容器」—— Cover 自己只认展示用的 props。
          ★ 这一层**在拖拽区里**（左键按住即拖窗口，样式表里那份 no-drag 名单不含它），所以
            它上面**不再挂任何鼠标动作**：那一格的事件整片被窗口系统收走，挂了也是死代码。
            原先挂在这儿的两个不透明度旋钮，现在在右上角那颗下拉钮上（见 opacityMenu）。
          尺寸直接取 CSS 那条 --mini-bar-h（不在这儿另写一份数值），圆角给 0：贴着窗口
          边缘的圆角块看着像没对齐。width 是向后端要的缩略宽度（?w=），按显示尺寸的两倍给。
        */}
          <div className="mini-cover">
            <Cover
              coverUrl={song?.cover_url}
              width={128}
              size="var(--mini-bar-h)"
              radius={0}
              kind="song"
            />
          </div>

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
                text={song?.title ?? '未在播放'}
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
              <button
                type="button"
                className="icon-btn"
                data-active={player.playMode === 'random'}
                aria-label={MODE_LABEL[player.playMode]}
                onClick={() => player.cyclePlayMode()}
              >
                {modeIcon(player.playMode, ICON_CTL)}
              </button>
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
            </div>
          </div>

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

          {/*
          右上角那一组：下拉菜单 + 关闭（关闭那颗与主窗口标题栏右端同款 .win-btn，只是小一档）。
          ★ 下拉那颗是不透明度那两个旋钮**唯一**的入口：封面归拖拽区之后右键到不了页面
            （见 opacityMenu 与样式表里那份 no-drag 名单）。
          ★ 原先这里还有一颗最小化，已去掉 —— 理由见文件头那一段（系统那一侧的最小化还在，
            从底栏那颗按钮或托盘再点一下就唤回来）。
          它们整个落在控件行上方那条缝里（高度由 CSS 按条高与控件高算出来），所以那一行
          的空隙有多高，这里的图标就只能是多大 —— 11px 是这条缝能舒服放下的上限。
        */}
          <div className="mini-window-actions">
            <button
              type="button"
              className="win-btn"
              aria-label="不透明度"
              aria-expanded={menuOpen}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                // 右对齐：触发器就贴着窗口右缘，左对齐会让面板整块探到窗外去
                useContextMenu.getState().show(rect.left, rect.bottom + 6, opacityMenu(), {
                  anchor: event.currentTarget,
                  align: 'right',
                  anchorRect: rect
                })
              }}
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
        </footer>

        {/*
        展开时才挂面板，且挂在播放条**之后**（它在进度线下方）。窗口高度是主进程一步到位的
        （原生窗口的尺寸做不了动画），内容这边补一点淡入，看着才不像「啪」地一下多出一块。

        ★ 歌词与队列共用这一块地方：主进程那边只有「开没开」一个布尔量，换内容不动窗口尺寸，
          所以两颗钮之间来回点不会闪也不会跳。队列那一份要自己给滚动容器（见 .mini-queue）——
          歌词那边是 LyricsView 里的 .lyrics 自带 flex: 1 + overflow-y: auto。
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
            ★ 松手才落盘（settings.miniPanelHeight），拖动期间只改内存 —— 每个 pointermove 写一次
              配置就是几十次全量落盘，主进程会被拖住（与音量那套合并写同一个理由）。
          */}
            <ResizeHandle />
          </div>
        ) : null}
      </div>

      {/*
        透明容器：窗口比「条 + 面板」多出来的那一部分全归它（系统事件把窗口拉成半屏 / 全屏时
        就是它顶着，菜单开着时它让出来的那一段就是菜单的地方），播放条与面板的尺寸一个像素都
        不跟着变。
        ★ 它是透明的（不铺任何底色）。落在它上面的鼠标按「拖窗口的把手」算 —— 与封面、中栏
          同一种手感：一块空地方，按下去就是把挂件挪个位置。
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
 */
function ResizeHandle(): React.JSX.Element {
  const panelHeight = useMiniView((s) => s.panelHeight)
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
        void patchSettings({ miniPanelHeight: useMiniView.getState().panelHeight })
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

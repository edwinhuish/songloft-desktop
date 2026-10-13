/**
 * 迷你模式的全部界面：一条紧凑播放条，外加一块可展开的面板（歌词或播放队列）。
 *
 * ★ 它不是「另一个播放器」：读同一个 usePlayer、调同一套 seek / toggle / next / previous，
 *   进度条连组件都复用底栏那一份（PlayerProgress），队列连组件都复用抽屉那一份（Panel 的
 *   Queue）。「与现有底栏保持一致」只有这样才守得住 —— 各写一套的话，两处的拖动手感
 *   （松手才 seek）、拖拽排序、跟随当前曲滚动迟早分叉。
 * ★ 窗口是无边框的，标题栏此刻正被藏着 —— 拖拽区与那三颗窗口钮（最小化 / 退出迷你模式 /
 *   关闭）都得自己给，少一颗就是「这个窗挪不动 / 回不去 / 关不掉」。三颗照标题栏右端那一组
 *   的样子来（同用 .win-btn，只是各小一档），并排落在条的**右上角** —— 那是这个动作在桌面
 *   应用里的固定位置，两种形态下长相一致，用户不必重新找。
 * ★ 条上那一行只放播放必需的东西（封面 / 歌名与时长 / 上一首 / 播放 / 下一首 / 歌词 / 队列）：
 *   迷你模式的意思就是把它挂在屏幕一角，不该再摆音量条、播放模式、收藏那一整套。
 *   右上角那三颗窗口钮**不进那一行**（绝对定位，落在这 64px 上方本来就空着的那条缝里，
 *   见 .mini-window-actions）：条里那点横向余量只有歌名在吃，让三颗去占一行就是把歌名挤窄。
 * ★ 封面右边那两行见下面 ScrollingLine 与 .mini-info：第一行「歌名 - 歌手」放不下就滚动。
 * ★ 歌词与队列**共用下方那一块面板**（见 MiniPanel）：两颗钮互斥，尺寸只跟「开没开」有关，
 *   所以换内容不闪不跳。
 * ★ 栅格的顺序是「播放条在**上**、面板在下」（DOM 顺序同此），不是反过来：窗口加高时长的是
 *   下半截（main/windows.ts 的 applyMiniSize 不动位置），面板摆下面才等于「原地展开」——
 *   摆上面的话一展开这一整排控件就要往下跳 400 px。进度线贴在播放条的下边缘，
 *   于是收起时它正好落在窗口下边缘，展开时它又正好是「播放条 / 面板」的分界线。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  IconClose,
  IconLyrics,
  IconMinimize,
  IconPause,
  IconPlay,
  IconQueue,
  IconRestore,
  IconSkipBack,
  IconSkipForward
} from './Icons'
import { LyricsView } from './LyricsView'
import { Queue } from './Panel'
import { PlayerProgress } from './PlayerProgress'
import { Cover } from './primitives'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { useUi } from '@/state/useUi'

export function MiniPlayer(): React.JSX.Element {
  const player = usePlayer()
  /** 下方那块面板装什么（null = 收起）。歌词与播放队列共用它，见 MiniPanel */
  const panel = useUi((s) => s.miniPanel)
  const togglePanel = useUi((s) => s.toggleMiniPanel)
  const setMini = useUi((s) => s.setMini)
  /** 与底栏同一份用途：拖动进度条时手上的位置（这里显示成那行时长） */
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

  return (
    <div className="mini-player" data-expanded={panel !== null ? 'true' : undefined}>
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
          封面是**贴左缘的全高方块**（尺寸直接取 CSS 那条 --mini-bar-h，不在这儿另写一份
          数值），圆角给 0：贴着窗口边缘的圆角块看着像没对齐。
          width 是向后端要的缩略宽度（?w=），按显示尺寸的两倍给，高 DPI 下不糊。
        */}
        <Cover
          coverUrl={song?.cover_url}
          width={128}
          size="var(--mini-bar-h)"
          radius={0}
          kind="song"
        />

        <div className="mini-info">
          {/* key 取歌曲 id：换歌要**从头**滚起（重挂一次 DOM = 动画重来），
              不然新歌一上来就接在上一首滚到一半的位置上 */}
          <ScrollingLine
            key={song?.id ?? 0}
            title={song?.title ?? '未在播放'}
            artist={song ? displayArtist(song.artist) : ''}
          />
          <div className="mini-time">
            {formatDuration(position)}/{formatDuration(duration)}
          </div>
        </div>

        <button
          type="button"
          className="icon-btn"
          data-tip="上一首"
          aria-label="上一首"
          disabled={!song}
          onClick={() => void player.previous()}
        >
          <IconSkipBack size={18} />
        </button>
        <button
          type="button"
          className="play-btn"
          data-tip={player.playing ? '暂停' : '播放'}
          aria-label={player.playing ? '暂停' : '播放'}
          disabled={!song}
          onClick={() => void player.toggle()}
        >
          {/*
            两颗图标尺寸刻意不同：三角形那个字形本身只占方框的四成宽，而**面积**只有它外接
            矩形的一半（暂停那两根竖条是实打实的满框），同一个 size 下三角形看着就是小一号。
            所以播放给 15、暂停给 13 —— 这样两个状态切换时才不会像「图标突然缩了一截」。
          */}
          {player.playing ? <IconPause size={13} /> : <IconPlay size={15} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tip="下一首"
          aria-label="下一首"
          disabled={!song}
          onClick={() => void player.next(false)}
        >
          <IconSkipForward size={18} />
        </button>

        <button
          type="button"
          className="icon-btn"
          data-active={panel === 'lyrics'}
          data-tip={panel === 'lyrics' ? '收起歌词' : '歌词'}
          aria-label={panel === 'lyrics' ? '收起歌词' : '歌词'}
          onClick={() => togglePanel('lyrics')}
        >
          <IconLyrics size={17} />
        </button>
        {/* 队列与歌词共用下面那一块面板，所以两颗钮互斥：点另一颗是**换内容**，不是叠一层 */}
        <button
          type="button"
          className="icon-btn"
          data-active={panel === 'queue'}
          data-tip={panel === 'queue' ? '收起播放队列' : '播放队列'}
          aria-label={panel === 'queue' ? '收起播放队列' : '播放队列'}
          onClick={() => togglePanel('queue')}
        >
          <IconQueue size={17} />
        </button>
        {/*
          右上角那一组：最小化 / 退出迷你模式 / 关闭（从左至右，与标题栏右端同序）。
          它整个落在控件行上方那条空隙里（高度由 CSS 按条高与控件高算出来），所以那一行
          的空隙有多高，这里的图标就只能是多大 —— 11px 是这条缝能舒服放下的上限。
        */}
        <div className="mini-window-actions">
          <button
            type="button"
            className="win-btn"
            data-tip="最小化"
            aria-label="最小化"
            onClick={() => void window.songloft.window.minimize()}
          >
            <IconMinimize size={11} />
          </button>
          <button
            type="button"
            className="win-btn"
            data-tip="退出迷你模式"
            aria-label="退出迷你模式"
            onClick={() => setMini(false)}
          >
            <IconRestore size={11} />
          </button>
          <button
            type="button"
            className="win-btn"
            data-variant="close"
            data-tip="关闭"
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
      */}
      {panel ? (
        <div className="mini-panel">
          {panel === 'lyrics' ? (
            <LyricsView compact />
          ) : (
            <div className="mini-queue">
              <Queue />
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 「歌名 - 歌手」那一行：**放不下就来回滚动**。
 *
 * ★ 位移与时长由 JS 量、动画交给 CSS：滚动速度得跟着**溢出距离**走 —— 长歌名该滚得久一点、
 *   短的三两下就该到头；写死一个 animation-duration 的结果是「短的慢得发慌、长的还没走完
 *   就回头」。量出来的两个值写成 CSS 变量，动画本身仍在样式表里（见 .mini-line-track）。
 * ★ 不溢出时一个 data 属性都不挂：绝大多数时候这行是静态的，常挂着 animation 只是白烧电。
 *   prefers-reduced-motion 由 base.css 那条全局规则兜住（动画时长会被压到 0.01ms），
 *   那种情况下它停在行首，效果与「截断显示」等价。
 * ★ 量的是「内层真实文本宽 - 外层可视宽」：内层特意写成 width: max-content（见样式表），
 *   所以它不会被外层剪窄，量出来的就是文本自己的宽度。
 */
function ScrollingLine({ title, artist }: { title: string; artist: string }): React.JSX.Element {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  /** 需要往左让出的像素：0 = 这一行放得下，不滚 */
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const measure = (): void => {
      const overflow = inner.offsetWidth - outer.clientWidth
      // 4px 以内当没溢出：为了几个像素来回蹭，比截断还难看
      setShift(overflow > 4 ? overflow : 0)
    }
    measure()
    /* 窗口宽度、字号、歌词面板开合都会改这一行的可见宽度 —— 交给 ResizeObserver，
       不然「拉动窗口之后该滚的不滚、不该滚的一直晃」。
       文本变了则由下面那个依赖数组负责重测（可见宽度没变，观察器不会响）。 */
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [title, artist])

  return (
    <div className="mini-line" ref={outerRef}>
      <span
        className="mini-line-track"
        ref={innerRef}
        data-scroll={shift > 0 ? 'true' : undefined}
        style={
          shift > 0
            ? ({
                // 40px/s 的观感速度；两头各停 0.8s（停顿是 keyframes 里那两段百分比给的）
                '--mini-line-shift': `-${shift}px`,
                '--mini-line-dur': `${(shift / 40 + 1.6).toFixed(2)}s`
              } as React.CSSProperties)
            : undefined
        }
      >
        <span className="playerbar-title">{title}</span>
        {/* 没在播放时没有歌手，那半截连分隔号一起不画 —— 不能留下一个孤零零的「-」 */}
        {artist ? <span className="playerbar-artist"> - {artist}</span> : null}
      </span>
    </div>
  )
}

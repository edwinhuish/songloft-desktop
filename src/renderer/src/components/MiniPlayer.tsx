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
 * ★ 条上那一行只放播放必需的东西（封面 / 三行信息 / 上一首 / 播放 / 下一首 / 歌词 / 队列）：
 *   迷你模式的意思就是把它挂在屏幕一角，不该再摆音量条、播放模式、收藏那一整套。
 *   右上角那三颗窗口钮**不进那一行**（绝对定位，落在这 64px 上方本来就空着的那条缝里，
 *   见 .mini-window-actions）：条里那点横向余量只有信息那三行在吃，让三颗去占一行就是
 *   把三行一起挤窄。
 * ★ 封面右边是**三行**（歌名 / 歌手 / 播放时间），见下面 ScrollingLine 与 .mini-info：
 *   行高由条高等分出来（栅格三行），所以哪一行有没有内容都不影响另外两行的位置；
 *   这一栏的宽度是被条宽定死的（栅格列定死 + flex: 1 1 0 + min-width: 0 + overflow: hidden），
 *   歌名再长也撑不开它 —— 右边那几颗钮因此永远钉在各自的位置上。
 *   哪一行放不下，**那一行自己**循环滚（不是来回蹭），另外两行不动。
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
  IconPin,
  IconPlay,
  IconQueue,
  IconRestore,
  IconSkipBack,
  IconSkipForward
} from './Icons'
import { openMenuFromEvent } from './ContextMenu'
import { LyricsView } from './LyricsView'
import { Queue } from './Panel'
import { PlayerProgress } from './PlayerProgress'
import { Cover } from './primitives'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { useSettings } from '@/state/useSettings'
import { useUi } from '@/state/useUi'

export function MiniPlayer(): React.JSX.Element {
  const player = usePlayer()
  /** 下方那块面板装什么（null = 收起）。歌词与播放队列共用它，见 MiniPanel */
  const panel = useUi((s) => s.miniPanel)
  const togglePanel = useUi((s) => s.toggleMiniPanel)
  const setMini = useUi((s) => s.setMini)
  /** 迷你窗口自己那份置顶设置（默认开，与普通窗口那份各存各的，见 AppSettings 的说明） */
  const miniOnTop = useSettings((s) => s.settings.miniAlwaysOnTop)
  const patchSettings = useSettings((s) => s.patch)
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
      <footer
        className="mini-bar"
        /*
         * 右键这条播放条 = 迷你窗的「窗口菜单」。挂在条上而不是外面那个 .mini-player 上：
         * 面板（队列 / 歌词）里各有自己的右键菜单（歌曲菜单），套一层会把它们盖掉。
         * 拖拽区里右键仍能收到 contextmenu（只有左键被拿去拖窗口）。
         */
        onContextMenu={(event) =>
          openMenuFromEvent(event, [
            {
              key: 'mini-always-on-top',
              label: miniOnTop ? '取消迷你窗口置顶' : '迷你窗口置顶',
              icon: <IconPin size={14} />,
              onClick: () => void patchSettings({ miniAlwaysOnTop: !miniOnTop })
            }
          ])
        }
      >
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

        {/*
          歌名 / 歌手 / 时间各占一行（`.mini-info` 是三等分的栅格，见样式表）。
          三行**各滚各的**：谁放不下谁滚，另外两行该静止还是静止 —— 行与行之间没有任何联动。
          ★ key 取歌曲 id：换歌要**从头**滚起（重挂一次 DOM = 动画重来），不然新歌一上来
            就接在上一首滚到一半的位置上。时间那一行不挂 key —— 它每秒都在变，重挂纯属浪费，
            而它又永远放得下（见 styles/components.css 里 .mini-time 那段）。
        */}
        <div className="mini-info">
          <ScrollingLine
            key={`title-${song?.id ?? 0}`}
            className="playerbar-title"
            text={song?.title ?? '未在播放'}
          />
          {/* 歌手与歌名分了两行，这里就没有「 - 」那半截了 —— 没在播放时这一行整行空着，
              不画占位符（行高由栅格给，空行也不会把另外两行拽歪） */}
          <ScrollingLine
            key={`artist-${song?.id ?? 0}`}
            className="playerbar-artist"
            text={song ? displayArtist(song.artist) : ''}
          />
          <ScrollingLine
            className="mini-time"
            text={`${formatDuration(position)}/${formatDuration(duration)}`}
          />
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
              {/* currentSlot = 2：当前曲固定落在**从上往下第 3 格**（上面留两行）。
                  面板只有 416px 高，只保证「看得见」的话它会贴着下边缘、或干脆在视野之外。 */}
              <Queue currentSlot={2} />
            </div>
          )}
        </div>
      ) : null}
    </div>
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
 * 歌名 / 歌手 / 时间各是一个实例，各自量各自的宽度、各自决定滚不滚 ——
 * 一行在滚不会让另外两行动一下（它们连动画都没挂）。
 *
 * ★ 「循环」= 文本连续两份首尾相接，动画只把整条往左推**一份**（含间隔）的距离，推到尽头时
 *   第二份的脑袋正好落在第一份原来的位置上 —— 于是画面与起点逐像素相同，接得严丝合缝。
 *   `animation-direction: alternate`（来回滚）做不到这一点：它滚到头会**倒着**退回去，
 *   读到一半的信息被倒放一遍，长标题尤其明显。
 * ★ 位移与时长由 JS 量、动画交给 CSS：速度得跟着**文本宽度**走 —— 长的该滚得久一点、
 *   短的三两下就到头；写死一个 animation-duration 的结果是「短的慢得发慌、长的还在挪」。
 *   量出来的值写成 CSS 变量，动画本身仍在样式表里（见 .mini-line-track）。
 * ★ 有两条前提，缺一条这套就静默失效：
 *   ① 外层 .mini-line 的宽度由外面定死（.mini-info 那一栏：栅格列 + min-width: 0），
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
  /** 文本自己的样式（.playerbar-title / .playerbar-artist / .mini-time 那一套），行本身不带 */
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
    /* 窗口宽度、字号、歌词面板开合都会改这一行的可见宽度 —— 交给 ResizeObserver，
       不然「该滚的不滚、不该滚的一直晃」。
       文本变了则由下面那个依赖数组负责重测（可见宽度没变，观察器不会响）。
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

/**
 * 底部播放栏。
 *
 * 一条细节值得说明：进度条做成贴在栏**顶部**的一条 3px 细线（hover 时变粗到 5px），
 * 而不是占一整行的独立控件 —— 桌面宽屏下这样能省掉一整行垂直空间，
 * 同时滚动的进度始终可见。这是相对 Flutter 端移动优先布局最明显的桌面化调整。
 * 它的实现在 components/PlayerProgress.tsx（迷你模式那条栏与它共用同一份）。
 */

import { useMemo, useState } from 'react'

import {
  IconHeart,
  IconLyrics,
  IconMini,
  IconPause,
  IconPlay,
  IconQueue,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeX
} from './Icons'
import { PlayerProgress } from './PlayerProgress'
import { MODE_ICON, MODE_LABEL } from './play-mode'
import { Cover, Slider } from './primitives'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { usePlaylists } from '@/state/usePlaylists'
import { useUi } from '@/state/useUi'

/**
 * 底栏里的图标尺寸。
 *
 * ★ 规则：**除主播放键外一律是原值的 1.5 倍**（16 → 24、17 → 26、19 → 28）。
 *   原来那几颗在宽屏底栏上偏小，一眼看不出画的是什么；放大之后主次仍然清楚 ——
 *   主播放键（44px 实心圆 + 19px 图标）刻意没动：它靠「整条上唯一的实心圆 + accent 填充」
 *   立在那儿，不必再靠尺寸压别人一头。旁边的钮跟着长了一档（38px，见 components.css
 *   的 .playerbar .icon-btn），否则 1.5 倍的字形会顶到悬浮底色的边上。
 * ★ 播放模式那一颗的尺寸不在这三档里：它由 play-mode.tsx 自己定（三处播放界面共用，
 *   包括跑在另一个窗口里的迷你条），底栏只是取用方。
 */
const ICON_SM = 24 // 原 16：收藏
const ICON_MD = 26 // 原 17：歌词 / 队列 / 迷你 / 音量
const ICON_LG = 28 // 原 19：上一首 / 下一首

export function PlayerBar(): React.JSX.Element {
  const player = usePlayer()
  const { panelOpen, panelTab, togglePanel, miniOpen, setFullPlayer } = useUi()
  const favoriteIds = usePlaylists((s) => s.favoriteIds)
  const toggleFavorite = usePlaylists((s) => s.toggleFavorite)
  /** 拖动进度条时手上的位置；null = 没在拖（见 PlayerProgress 的说明） */
  const [scrub, setScrub] = useState<number | null>(null)

  const song = useMemo(
    () =>
      player.cursor >= 0 && player.cursor < player.order.length
        ? player.queue[player.order[player.cursor]]
        : null,
    [player.cursor, player.order, player.queue]
  )

  const duration = player.duration || song?.duration || 0
  // 拖动中显示手上的位置（下面那行时长文字也跟着走），松手后才回到播放器的真实进度
  const position = scrub ?? player.currentTime
  const favorited = song ? favoriteIds.has(song.id) : false
  const hasTrackSwitch = player.tracks.length > 1

  return (
    <footer className="playerbar">
      {/* 拖动 / 键盘那一整套在 PlayerProgress 里，与迷你模式那条栏共用同一份 */}
      <PlayerProgress
        duration={duration}
        position={player.currentTime}
        scrub={scrub}
        onScrub={setScrub}
        onSeek={(seconds) => player.seek(seconds)}
        onSeekBy={(delta) => player.seekBy(delta)}
      />

      {/* 左侧：当前曲目 */}
      <div className="playerbar-now">
        {/*
          封面 = **进满窗播放**（见 components/FullPlayer.tsx）：大封面 + 歌词 + 控制条盖住
          标题栏以下整块。它原先开的是右侧抽屉 —— 抽屉没被砍掉，入口改成上面那颗
          「歌词面板」与 Ctrl+L（「看一眼歌词」和「把播放器铺满一屏」本来就是两件事）。
        */}
        <button
          type="button"
          className="playerbar-cover"
          data-tip="满窗播放"
          aria-label="满窗播放"
          onClick={() => setFullPlayer(true)}
        >
          <Cover coverUrl={song?.cover_url} width={112} size={54} radius={10} kind="song" />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="playerbar-title truncate">{song?.title ?? '未在播放'}</div>
          <div className="playerbar-artist truncate">
            {song ? displayArtist(song.artist) : '从曲库选一首开始播放'}
          </div>
        </div>
        {song ? (
          <button
            type="button"
            className="icon-btn"
            data-active={favorited}
            data-tip={favorited ? '取消收藏' : '收藏'}
            aria-label={favorited ? '取消收藏' : '收藏'}
            onClick={() => void toggleFavorite(song)}
          >
            <IconHeart size={ICON_SM} filled={favorited} />
          </button>
        ) : null}
      </div>

      {/* 中间：传输控制 */}
      <div className="playerbar-controls">
        {/*
          播放模式钮刻意**不带 data-active**：当前是哪一档由图标本身示意
          （每档一颗不同的图标，见 play-mode.tsx），再点一层 accent 色没有多说明任何事，
          却让它在传输控制这一排里单独亮着 —— 与相邻几颗钮不是一个观感。
        */}
        <button
          type="button"
          className="icon-btn"
          data-tip={MODE_LABEL[player.playMode]}
          aria-label={MODE_LABEL[player.playMode]}
          onClick={() => player.cyclePlayMode()}
        >
          {MODE_ICON[player.playMode]}
        </button>

        <button
          type="button"
          className="icon-btn"
          data-tip="上一首"
          aria-label="上一首"
          disabled={!song}
          onClick={() => void player.previous()}
        >
          <IconSkipBack size={ICON_LG} />
        </button>

        <button
          type="button"
          className="play-btn"
          data-tip={player.playing ? '暂停' : '播放'}
          aria-label={player.playing ? '暂停' : '播放'}
          disabled={!song}
          onClick={() => void player.toggle()}
        >
          {player.playing ? <IconPause size={19} /> : <IconPlay size={19} />}
        </button>

        <button
          type="button"
          className="icon-btn"
          data-tip="下一首"
          aria-label="下一首"
          disabled={!song}
          onClick={() => void player.next(false)}
        >
          <IconSkipForward size={ICON_LG} />
        </button>

        <span className="playerbar-time">
          {formatDuration(position)} / {formatDuration(duration)}
        </span>
      </div>

      {/* 右侧：视图与音量 */}
      <div className="playerbar-right">
        {hasTrackSwitch ? (
          <select
            className="input"
            style={{ width: 96, height: 30, fontSize: 12 }}
            value={player.activeTrack}
            onChange={(event) => void player.setActiveTrack(Number(event.target.value))}
            data-tip="切换音轨（原唱 / 伴奏）"
          >
            {player.tracks.map((track) => (
              <option key={track.index} value={track.index}>
                {track.title || track.language || `音轨 ${track.index + 1}`}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          className="icon-btn"
          data-active={panelOpen && panelTab === 'now-playing'}
          data-tip="歌词面板"
          aria-label="歌词面板"
          onClick={() => togglePanel('now-playing')}
        >
          <IconLyrics size={ICON_MD} />
        </button>

        <button
          type="button"
          className="icon-btn"
          data-active={panelOpen && panelTab === 'queue'}
          data-tip="播放队列"
          aria-label="播放队列"
          onClick={() => togglePanel('queue')}
        >
          <IconQueue size={ICON_MD} />
        </button>

        {/*
          迷你播放器。它与上面两颗「面板」按钮是同一类（换一个看播放器的姿势），所以并排放在
          这里；点一下**开一个独立的迷你窗口**，再点一下关掉它 —— data-active 就是它此刻开着
          没有（那是主进程的回声，见 useUi.miniOpen）。

          ★ 主窗口本身**一点都不动**：不缩、不重排、不换界面，也不丢焦点之外的任何状态。
            这颗按钮要的就只是「那条挂件开着没有」这一个布尔量 —— 从前那种「点一下整个窗口
            缩成 400×64」的做法，会把主界面里的一切都按 400px 重排一次（扩展的 webview 尤其
            经不起），也正是它被拆成独立窗口的原因。
        */}
        <button
          type="button"
          className="icon-btn"
          data-active={miniOpen}
          data-tip={miniOpen ? '关闭迷你播放器' : '迷你播放器'}
          aria-label={miniOpen ? '关闭迷你播放器' : '迷你播放器'}
          onClick={() => void window.songloft.mini.setOpen(!miniOpen)}
        >
          <IconMini size={ICON_MD} />
        </button>

        <div className="volume-group">
          <button
            type="button"
            className="icon-btn"
            data-tip={player.muted ? '取消静音' : '静音'}
            aria-label={player.muted ? '取消静音' : '静音'}
            onClick={() => player.toggleMute()}
          >
            {player.muted || player.volume === 0 ? (
              <IconVolumeX size={ICON_MD} />
            ) : (
              <IconVolume level={player.volume > 0.55 ? 2 : 1} size={ICON_MD} />
            )}
          </button>
          <Slider
            ariaLabel="音量"
            value={player.muted ? 0 : player.volume * 100}
            max={100}
            // 拖动期间只改内存（setVolume 内部会把落盘合并成一跳），
            // 松手再立刻 flush，避免「拖完就退出」丢掉最后一次音量
            onChange={(value) => player.setVolume(value / 100)}
            onCommit={(value) => {
              player.setVolume(value / 100)
              player.flushVolume()
            }}
          />
        </div>
      </div>
    </footer>
  )
}

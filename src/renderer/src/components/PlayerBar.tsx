/**
 * 底部播放栏。
 *
 * 一条细节值得说明：进度条做成贴在栏**顶部**的一条 3px 细线（hover 时变粗到 5px），
 * 而不是占一整行的独立控件 —— 桌面宽屏下这样能省掉一整行垂直空间，
 * 同时滚动的进度始终可见。这是相对 Flutter 端移动优先布局最明显的桌面化调整。
 * 它的实现在 components/PlayerProgress.tsx（迷你模式那条栏与它共用同一份）。
 */

import { useMemo, useState } from 'react'

import type { PlayMode } from '@shared/types'
import {
  IconHeart,
  IconLyrics,
  IconMini,
  IconPause,
  IconPlay,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeX
} from './Icons'
import { PlayerProgress } from './PlayerProgress'
import { Cover, Slider } from './primitives'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { usePlaylists } from '@/state/usePlaylists'
import { useUi } from '@/state/useUi'

const MODE_ICON: Record<PlayMode, React.ReactNode> = {
  order: <IconRepeat size={16} />,
  loop: <IconRepeat size={16} />,
  single: <IconRepeatOne size={16} />,
  random: <IconShuffle size={16} />
}

const MODE_LABEL: Record<PlayMode, string> = {
  order: '顺序播放',
  loop: '列表循环',
  single: '单曲循环',
  random: '随机播放'
}

export function PlayerBar(): React.JSX.Element {
  const player = usePlayer()
  const { panelOpen, panelTab, togglePanel, mini, setMini } = useUi()
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
        <button
          type="button"
          onClick={() => togglePanel('now-playing')}
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
          data-tip="查看正在播放"
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
            <IconHeart size={16} filled={favorited} />
          </button>
        ) : null}
      </div>

      {/* 中间：传输控制 */}
      <div className="playerbar-controls">
        <button
          type="button"
          className="icon-btn"
          data-active={player.playMode === 'random'}
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
          <IconSkipBack size={19} />
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
          <IconSkipForward size={19} />
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
          <IconLyrics size={17} />
        </button>

        <button
          type="button"
          className="icon-btn"
          data-active={panelOpen && panelTab === 'queue'}
          data-tip="播放队列"
          aria-label="播放队列"
          onClick={() => togglePanel('queue')}
        >
          <IconQueue size={17} />
        </button>

        {/*
          迷你模式。它与上面两颗「面板」按钮是同一类（换一个看播放器的姿势），所以并排放在这里；
          点一下整个界面收成一条小播放条（窗口也跟着变小，见 main/windows.ts），
          再点一下回来 —— data-active 就是当前状态。
        */}
        <button
          type="button"
          className="icon-btn"
          data-active={mini}
          data-tip={mini ? '退出迷你模式' : '迷你模式'}
          aria-label={mini ? '退出迷你模式' : '迷你模式'}
          onClick={() => setMini(!mini)}
        >
          <IconMini size={17} />
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
              <IconVolumeX size={17} />
            ) : (
              <IconVolume level={player.volume > 0.55 ? 2 : 1} size={17} />
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

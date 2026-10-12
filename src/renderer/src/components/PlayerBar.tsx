/**
 * 底部播放栏。
 *
 * 一条细节值得说明：进度条做成贴在栏**顶部**的一条 3px 细线（hover 时变粗到 5px），
 * 而不是占一整行的独立控件 —— 桌面宽屏下这样能省掉一整行垂直空间，
 * 同时滚动的进度始终可见。这是相对 Flutter 端移动优先布局最明显的桌面化调整。
 */

import { useMemo, useState } from 'react'

import type { PlayMode } from '@shared/types'
import {
  IconHeart,
  IconLyrics,
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
  const { panelOpen, panelTab, togglePanel, setPanelTab } = useUi()
  const favoriteIds = usePlaylists((s) => s.favoriteIds)
  const toggleFavorite = usePlaylists((s) => s.toggleFavorite)
  const [scrub, setScrub] = useState<number | null>(null)

  const song = useMemo(
    () => (player.cursor >= 0 && player.cursor < player.order.length ? player.queue[player.order[player.cursor]] : null),
    [player.cursor, player.order, player.queue]
  )

  const duration = player.duration || song?.duration || 0
  const position = scrub ?? player.currentTime
  const favorited = song ? favoriteIds.has(song.id) : false
  const hasTrackSwitch = player.tracks.length > 1

  return (
    <footer className="playerbar">
      <div
        className="playerbar-progress"
        role="presentation"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setScrub(((event.clientX - rect.left) / rect.width) * duration)
        }}
      >
        <div className="playerbar-progress-track" />
        <div
          className="playerbar-progress-fill"
          style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
        />
      </div>

      {/* 左侧：当前曲目 */}
      <div className="playerbar-now">
        <button
          type="button"
          onClick={() => togglePanel('now-playing')}
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
          title="查看正在播放"
        >
          <Cover coverUrl={song?.cover_url} width={112} size={54} radius={10} />
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
            title={favorited ? '取消收藏' : '收藏'}
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
          title={MODE_LABEL[player.playMode]}
          aria-label={MODE_LABEL[player.playMode]}
          onClick={() => player.cyclePlayMode()}
        >
          {MODE_ICON[player.playMode]}
        </button>

        <button
          type="button"
          className="icon-btn"
          title="上一首"
          aria-label="上一首"
          disabled={!song}
          onClick={() => void player.previous()}
        >
          <IconSkipBack size={19} />
        </button>

        <button
          type="button"
          className="play-btn"
          title={player.playing ? '暂停' : '播放'}
          aria-label={player.playing ? '暂停' : '播放'}
          disabled={!song}
          onClick={() => void player.toggle()}
        >
          {player.playing ? <IconPause size={19} /> : <IconPlay size={19} />}
        </button>

        <button
          type="button"
          className="icon-btn"
          title="下一首"
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
            title="切换音轨（原唱 / 伴奏）"
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
          title="歌词面板"
          aria-label="歌词面板"
          onClick={() => setPanelTab('now-playing')}
        >
          <IconLyrics size={17} />
        </button>

        <button
          type="button"
          className="icon-btn"
          data-active={panelOpen && panelTab === 'queue'}
          title="播放队列"
          aria-label="播放队列"
          onClick={() => setPanelTab('queue')}
        >
          <IconQueue size={17} />
        </button>

        <div className="volume-group">
          <button
            type="button"
            className="icon-btn"
            title={player.muted ? '取消静音' : '静音'}
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
            onChange={(value) => player.setVolume(value / 100)}
          />
        </div>
      </div>
    </footer>
  )
}

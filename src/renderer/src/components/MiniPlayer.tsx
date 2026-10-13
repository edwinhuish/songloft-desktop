/**
 * 迷你模式的全部界面：一条紧凑播放条，外加一块可展开的歌词。
 *
 * ★ 它不是「另一个播放器」：读同一个 usePlayer、调同一套 seek / toggle / next / previous，
 *   进度条连组件都复用底栏那一份（PlayerProgress）。「与现有底栏保持一致」只有这样才守得住 ——
 *   各写一套的话，两处的拖动手感（松手才 seek）与键盘行为迟早分叉。
 * ★ 窗口是无边框的，所以拖拽区与「退出迷你 / 关闭」两颗钮必须自己给：正常界面里的标题栏
 *   此刻正被藏着，不给就等于把用户关在了一个挪不动也关不掉的窗里。
 * ★ 这里刻意只留播放必需的东西（上一首 / 播放 / 下一首 + 歌词 / 退出 / 关闭）：
 *   迷你模式的意思就是把它挂在屏幕一角，不该再摆音量条、播放模式、队列那一整套。
 */

import { useMemo, useState } from 'react'

import {
  IconClose,
  IconLyrics,
  IconPause,
  IconPlay,
  IconRestore,
  IconSkipBack,
  IconSkipForward
} from './Icons'
import { LyricsView } from './LyricsView'
import { PlayerProgress } from './PlayerProgress'
import { Cover } from './primitives'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { useUi } from '@/state/useUi'

export function MiniPlayer(): React.JSX.Element {
  const player = usePlayer()
  const lyricsOpen = useUi((s) => s.miniLyrics)
  const setMiniLyrics = useUi((s) => s.setMiniLyrics)
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
    <div className="mini-player" data-lyrics={lyricsOpen ? 'true' : undefined}>
      {/*
        展开时才挂歌词。窗口高度是主进程一步到位的（原生窗口的尺寸做不了动画），
        内容这边补一点淡入，看着才不像「啪」地一下多出一块。
      */}
      {lyricsOpen ? (
        <div className="mini-lyrics">
          <LyricsView compact />
        </div>
      ) : null}

      <footer className="mini-bar">
        <PlayerProgress
          duration={duration}
          position={player.currentTime}
          scrub={scrub}
          onScrub={setScrub}
          onSeek={(seconds) => player.seek(seconds)}
          onSeekBy={(delta) => player.seekBy(delta)}
        />

        <Cover coverUrl={song?.cover_url} width={76} size={40} radius={9} kind="song" />

        <div className="mini-info">
          <div className="playerbar-title truncate">{song?.title ?? '未在播放'}</div>
          <div className="playerbar-artist truncate">
            {song ? displayArtist(song.artist) : '从曲库选一首开始播放'}
          </div>
        </div>

        <span className="mini-time">
          {formatDuration(position)} / {formatDuration(duration)}
        </span>

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
          {player.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
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

        {/* 传输控制与「视图」两组之间那条细线：六颗图标一字排开时分不出组 */}
        <span className="mini-divider" aria-hidden="true" />

        <button
          type="button"
          className="icon-btn"
          data-active={lyricsOpen}
          data-tip={lyricsOpen ? '收起歌词' : '展开歌词'}
          aria-label={lyricsOpen ? '收起歌词' : '展开歌词'}
          onClick={() => setMiniLyrics(!lyricsOpen)}
        >
          <IconLyrics size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tip="退出迷你模式"
          aria-label="退出迷你模式"
          onClick={() => setMini(false)}
        >
          <IconRestore size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-variant="close"
          data-tip="关闭"
          aria-label="关闭"
          onClick={() => void window.songloft.window.close()}
        >
          <IconClose size={16} />
        </button>
      </footer>
    </div>
  )
}

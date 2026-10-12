/**
 * 右侧抽屉：正在播放（大封面 + 歌词）/ 播放队列。
 *
 * 做成常驻抽屉而不是独立路由页（Flutter 端「播放器」是一个整页路由）：
 * 桌面宽屏下用户往往想边看曲库边看歌词，切换整页会丢掉列表滚动位置。
 */

import { useEffect, useRef, useState } from 'react'

import { IconChevronLeft, IconListMusic, IconMusic, IconQueue, IconTrash } from './Icons'
import { Cover, EmptyState } from './primitives'
import { LyricsView } from './LyricsView'
import { openMenuFromEvent } from './ContextMenu'
import { buildSongMenuItems } from './songMenu'
import { displayArtist, formatDuration } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { useUi } from '@/state/useUi'

export function Panel(): React.JSX.Element | null {
  const { panelOpen, panelTab, setPanelTab, setPanelOpen } = useUi()
  if (!panelOpen) return null

  return (
    <aside className="panel" aria-label={panelTab === 'queue' ? '播放队列' : '正在播放'}>
      <div className="panel-head">
        <div className="row grow" style={{ gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            data-active={panelTab === 'now-playing'}
            title="正在播放"
            aria-label="正在播放"
            onClick={() => setPanelTab('now-playing')}
          >
            <IconMusic size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-active={panelTab === 'queue'}
            title="播放队列"
            aria-label="播放队列"
            onClick={() => setPanelTab('queue')}
          >
            <IconQueue size={16} />
          </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="收起面板"
          aria-label="收起面板"
          onClick={() => setPanelOpen(false)}
        >
          <IconChevronLeft size={16} />
        </button>
      </div>

      <div className="panel-body" style={panelTab === 'now-playing' ? { overflow: 'hidden' } : undefined}>
        {panelTab === 'now-playing' ? <NowPlaying /> : <Queue />}
      </div>
    </aside>
  )
}

function NowPlaying(): React.JSX.Element {
  const song = usePlayer((s) => (s.cursor >= 0 && s.cursor < s.order.length ? s.queue[s.order[s.cursor]] : null))
  const context = usePlayer((s) => s.context)

  if (!song) {
    return (
      <EmptyState
        icon={<IconMusic size={26} />}
        title="还没有在播放"
        description="从曲库挑一首，或按 Ctrl+K 搜索"
      />
    )
  }

  return (
    <div className="now-playing">
      <div className="now-playing-art-wrap">
        <div className="now-playing-art">
          <Cover coverUrl={song.cover_url} width={640} size="100%" radius={0} />
        </div>
      </div>
      <div className="now-playing-meta">
        <div className="now-playing-title">{song.title}</div>
        <div className="now-playing-sub">
          {displayArtist(song.artist)}
          {song.album ? ` · ${song.album}` : ''}
        </div>
        <div className="row" style={{ marginTop: 7, gap: 6, flexWrap: 'wrap' }}>
          {context ? <span className="badge">来自{context.type === 'playlist' ? '歌单' : context.type}</span> : null}
          {song.format ? <span className="badge">{song.format.toUpperCase()}</span> : null}
          {song.bit_rate ? <span className="badge">{Math.round(song.bit_rate / 1000)}k</span> : null}
          {song.year ? <span className="badge">{song.year}</span> : null}
        </div>
      </div>
      <LyricsView />
    </div>
  )
}

function Queue(): React.JSX.Element {
  const queue = usePlayer((s) => s.queue)
  const order = usePlayer((s) => s.order)
  const cursor = usePlayer((s) => s.cursor)
  const moveInQueue = usePlayer((s) => s.moveInQueue)
  const removeFromQueue = usePlayer((s) => s.removeFromQueue)
  const clearQueue = usePlayer((s) => s.clearQueue)
  const jumpTo = usePlayer((s) => s.jumpTo)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const currentIndex = cursor >= 0 && cursor < order.length ? order[cursor] : -1

  // 播放到下一首时把当前项滚进视野
  useEffect(() => {
    if (currentIndex < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-queue-index="${currentIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIndex])

  if (queue.length === 0) {
    return <EmptyState icon={<IconListMusic size={26} />} title="播放队列是空的" description="双击歌曲或右键「加入播放队列」" />
  }

  const totalDuration = queue.reduce((sum, s) => sum + (s.duration || 0), 0)

  return (
    <div ref={listRef}>
      <div
        className="row-between"
        style={{ padding: '12px 16px 6px', fontSize: 12, color: 'var(--text-4)' }}
      >
        <span>
          共 {queue.length} 首 · {formatDuration(totalDuration)}
        </span>
        <button type="button" className="btn" data-size="sm" data-variant="ghost" onClick={() => clearQueue()}>
          <IconTrash size={14} />
          清空
        </button>
      </div>

      {queue.map((song, index) => (
        <div
          key={`${song.id}-${index}`}
          className="queue-item"
          data-queue-index={index}
          data-current={index === currentIndex}
          data-dragging={dragIndex === index}
          onDoubleClick={() => void jumpTo(index)}
          onContextMenu={(event) => openMenuFromEvent(event, buildSongMenuItems([song]))}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(event) => {
            if (dragIndex === null) return
            event.preventDefault()
          }}
          onDrop={() => {
            if (dragIndex !== null && dragIndex !== index) moveInQueue(dragIndex, index)
            setDragIndex(null)
          }}
          onDragEnd={() => setDragIndex(null)}
        >
          <span className="queue-drag" title="拖动调整顺序">
            <IconMusic size={14} />
          </span>
          <Cover coverUrl={song.cover_url} width={72} size={38} radius={8} />
          <div style={{ minWidth: 0 }}>
            <div className="queue-title truncate">{song.title}</div>
            <div className="queue-artist truncate">{displayArtist(song.artist)}</div>
          </div>
          <div className="row" style={{ gap: 2 }}>
            <span className="song-duration">{formatDuration(song.duration)}</span>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              title="从队列移除"
              aria-label="从队列移除"
              onClick={() => removeFromQueue([index])}
            >
              <IconTrash size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 右侧抽屉：正在播放（大封面 + 歌词）/ 播放队列。
 *
 * 做成常驻抽屉而不是独立路由页（Flutter 端「播放器」是一个整页路由）：
 * 桌面宽屏下用户往往想边看曲库边看歌词，切换整页会丢掉列表滚动位置。
 */

import { useEffect, useRef, useState } from 'react'

import { IconChevronRight, IconListMusic, IconMusic, IconQueue, IconTrash } from './Icons'
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
        {/* 「收起」在左、页签在右：收起是把这块整个移走，跟「在面板内部换页」不是
            一类操作，分开摆就不容易点错。箭头朝右 —— 抽屉在窗口右边，收起就是往右走
            （侧栏在左边，它的收起箭头朝左，两边一致） */}
        <button
          type="button"
          className="icon-btn"
          data-tip="收起面板"
          aria-label="收起面板"
          onClick={() => setPanelOpen(false)}
        >
          <IconChevronRight size={16} />
        </button>
        <div className="row grow" style={{ gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            data-active={panelTab === 'now-playing'}
            data-tip="正在播放"
            aria-label="正在播放"
            onClick={() => setPanelTab('now-playing')}
          >
            <IconMusic size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-active={panelTab === 'queue'}
            data-tip="播放队列"
            aria-label="播放队列"
            onClick={() => setPanelTab('queue')}
          >
            <IconQueue size={16} />
          </button>
        </div>
      </div>

      <div
        className="panel-body"
        style={panelTab === 'now-playing' ? { overflow: 'hidden' } : undefined}
      >
        {panelTab === 'now-playing' ? <NowPlaying /> : <Queue />}
      </div>
    </aside>
  )
}

function NowPlaying(): React.JSX.Element {
  const song = usePlayer((s) =>
    s.cursor >= 0 && s.cursor < s.order.length ? s.queue[s.order[s.cursor]] : null
  )
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
          <Cover coverUrl={song.cover_url} width={640} size="100%" radius={0} kind="song" />
        </div>
      </div>
      <div className="now-playing-meta">
        <div className="now-playing-title">{song.title}</div>
        <div className="now-playing-sub">
          {displayArtist(song.artist)}
          {song.album ? ` · ${song.album}` : ''}
        </div>
        <div className="row" style={{ marginTop: 7, gap: 6, flexWrap: 'wrap' }}>
          {context ? (
            <span className="badge">来自{context.type === 'playlist' ? '歌单' : context.type}</span>
          ) : null}
          {song.format ? <span className="badge">{song.format.toUpperCase()}</span> : null}
          {song.bit_rate ? (
            <span className="badge">{Math.round(song.bit_rate / 1000)}k</span>
          ) : null}
          {song.year ? <span className="badge">{song.year}</span> : null}
        </div>
      </div>
      <LyricsView />
    </div>
  )
}

/**
 * 播放队列。
 *
 * ★ 导出是为了给**迷你模式那块面板**复用（见 MiniPlayer.tsx）：同一个队列在两处出现，
 *   两套实现迟早分叉（拖拽排序、右键菜单、跟随当前曲滚动…都得各写一遍）。
 *   注意它自己不带滚动容器 —— 谁挂它谁负责给（抽屉那边是 .panel-body，迷你那边是 .mini-queue）。
 */
/**
 * 从队列列表往上找**第一个真的能滚的祖先**：抽屉里是 .panel-body，迷你模式里是 .mini-queue。
 *
 * 存在的理由见下面那段 effect：我们要自己滚，就不能再让浏览器替我们猜容器。
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

export function Queue(): React.JSX.Element {
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
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-queue-index="${currentIndex}"]`)
    const container = findScrollParent(list ?? null)
    if (!item || !container) return

    /*
     * ★ 自己算偏移，**不用 item.scrollIntoView()**：那个 API 会把「它所有的祖先滚动容器」
     *   依次滚一遍，视口也在内。迷你模式下窗口只有 400×480，而列表项在文档里的位置可能
     *   远在窗口下方（被 .mini-queue 剪掉的那些仍然占着文档坐标），于是那一下会连着视口
     *   一起滚 —— 整条迷你播放器被顶出窗外，右上角那三颗窗口钮跟着不见。
     *   这里只滚这一个容器，而且只在需要时滚**最小**的距离（等价于 block: 'nearest'：
     *   在上方露不出来就贴顶、在下方露不出来就贴底，已经在视野里就不动）。
     */
    const cRect = container.getBoundingClientRect()
    const iRect = item.getBoundingClientRect()
    let delta = 0
    if (iRect.top < cRect.top) delta = iRect.top - cRect.top
    else if (iRect.bottom > cRect.bottom) delta = iRect.bottom - cRect.bottom
    if (delta === 0) return

    container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
  }, [currentIndex])

  if (queue.length === 0) {
    return (
      <EmptyState
        icon={<IconListMusic size={26} />}
        title="播放队列是空的"
        description="双击歌曲或右键「加入播放队列」"
      />
    )
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
        <button
          type="button"
          className="btn"
          data-size="sm"
          data-variant="ghost"
          onClick={() => clearQueue()}
        >
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
          <span className="queue-drag" data-tip="拖动调整顺序">
            <IconMusic size={14} />
          </span>
          <Cover coverUrl={song.cover_url} width={72} size={38} radius={8} kind="song" />
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
              data-tip="从队列移除"
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

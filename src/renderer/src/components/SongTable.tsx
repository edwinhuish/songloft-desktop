/**
 * 歌曲表。
 *
 * 桌面端相对移动端最该做好的地方就是这张表，所以这里把原实现里散在各处的
 * 行内动作、排序、多选、拖拽集中在同一个组件里：
 *   * 表头可排序（点击循环 升序 → 降序 → 取消）
 *   * 行 hover 才出现的快捷动作（播放/收藏/更多），不占常驻视觉
 *   * Ctrl/Cmd 点选、Shift 连选，配合侧栏批量操作
 *   * 行可直接拖到侧栏歌单（dataTransfer 带 `application/x-songloft-songs`）
 *   * 歌单上下文下支持拖拽重排（onReorder）
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import type { Song, SongSortField } from '@shared/types'
import { openMenuFromEvent, type MenuItem } from './ContextMenu'
import { IconGrip, IconHeart, IconMore, IconPause, IconPlay } from './Icons'
import { Cover, EmptyState, InfiniteSentinel, SongRowsSkeleton } from './primitives'
import { buildSongMenuItems, type SongMenuOptions } from './songMenu'
import { displayAlbum, displayArtist, formatDuration, formatRelative } from '@/lib/format'
import { usePlayer } from '@/state/usePlayer'
import { usePlaylists } from '@/state/usePlaylists'

export interface SongColumn {
  /**
   * 单元格种类。注意这里**没有**列表格线的语义，只有「渲染哪种 cell」：
   * 'index' 渲染序号+播放按钮，'actions' 渲染行尾的收藏/更多按钮。
   * 早期把 actions 也写成 key:'index' 会导致 grid 轨道数对不上（表头 7 列、行却多出一列），
   * 所以单列一个 'actions'。
   */
  key: 'index' | 'title' | 'artist' | 'album' | 'added' | 'duration' | 'actions'
  label?: string
  /** grid track 宽度 */
  width: string
  sortField?: SongSortField
  align?: 'left' | 'right'
}

const DURATION: SongColumn = { key: 'duration', label: '时长', width: '72px', sortField: 'duration', align: 'right' }
const ACTIONS: SongColumn = { key: 'actions', width: '84px' }
const INDEX: SongColumn = { key: 'index', label: '#', width: '38px' }
const TITLE: SongColumn = { key: 'title', label: '标题', width: 'minmax(180px, 2.6fr)', sortField: 'title' }
const ARTIST: SongColumn = { key: 'artist', label: '歌手', width: 'minmax(110px, 1.4fr)', sortField: 'artist' }
const ALBUM: SongColumn = { key: 'album', label: '专辑', width: 'minmax(110px, 1.4fr)', sortField: 'album' }
const ADDED: SongColumn = { key: 'added', label: '加入时间', width: '104px', sortField: 'added_at' }

export const LIBRARY_COLUMNS: SongColumn[] = [INDEX, TITLE, ARTIST, ALBUM, ADDED, DURATION, ACTIONS]
export const PLAYLIST_COLUMNS: SongColumn[] = [INDEX, TITLE, ARTIST, ALBUM, DURATION, ACTIONS]
export const COMPACT_COLUMNS: SongColumn[] = [INDEX, TITLE, ARTIST, DURATION, ACTIONS]

export interface SongSort {
  field: SongSortField
  order: 'asc' | 'desc'
}

export interface SongTableProps {
  songs: Song[]
  columns?: SongColumn[]
  /** 双击/点行内播放按钮时回调，参数是 songs 里的下标 */
  onPlayAt: (index: number) => void
  loading?: boolean
  /** 还有更多可加载时渲染无限滚动哨兵 */
  onLoadMore?: () => void
  hasMore?: boolean
  sort?: SongSort | null
  onSortChange?: (sort: SongSort | null) => void
  /** 受控多选（下标） */
  selection?: number[]
  onSelectionChange?: (indexes: number[], anchor: number | null) => void
  menuOptions?: SongMenuOptions
  /** 提供时启用拖拽重排 */
  onReorder?: (from: number, to: number) => void
  /** 空态文案 */
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** 额外的行右键项（追加在标准项之后） */
  extraMenuItems?: (song: Song) => MenuItem[]
  /** 虚拟化的行数上限提示：超过这个数只渲染前 N 行（避免一次性挂上万节点） */
  maxRendered?: number
}

export function SongTable({
  songs,
  columns = LIBRARY_COLUMNS,
  onPlayAt,
  loading,
  onLoadMore,
  hasMore,
  sort,
  onSortChange,
  selection = [],
  onSelectionChange,
  menuOptions,
  onReorder,
  emptyTitle = '这里还没有歌曲',
  emptyDescription,
  emptyAction,
  extraMenuItems,
  maxRendered = 1200
}: SongTableProps): React.JSX.Element {
  const currentSongId = usePlayer((s) => (s.cursor >= 0 && s.cursor < s.order.length ? s.queue[s.order[s.cursor]]?.id ?? null : null))
  const playing = usePlayer((s) => s.playing)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragSource = useRef<number | null>(null)
  const selectionSet = useMemo(() => new Set(selection), [selection])

  const gridTemplate = useMemo(() => columns.map((c) => c.width).join(' '), [columns])

  const cycleSort = (field: SongSortField): void => {
    if (!onSortChange) return
    if (sort?.field !== field) onSortChange({ field, order: 'asc' })
    else if (sort.order === 'asc') onSortChange({ field, order: 'desc' })
    else onSortChange(null)
  }

  const handleRowClick = useCallback(
    (event: React.MouseEvent, index: number) => {
      if (!onSelectionChange) return
      const additive = event.ctrlKey || event.metaKey
      const ranged = event.shiftKey
      if (ranged && selection.length > 0) {
        const anchor = selection[selection.length - 1]
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
        const next: number[] = []
        for (let i = from; i <= to; i += 1) next.push(i)
        onSelectionChange(next, index)
        return
      }
      if (additive) {
        const next = selectionSet.has(index) ? selection.filter((i) => i !== index) : [...selection, index]
        onSelectionChange(next, index)
        return
      }
      onSelectionChange([index], index)
    },
    [onSelectionChange, selection, selectionSet]
  )

  const visibleSongs = songs.length > maxRendered ? songs.slice(0, maxRendered) : songs

  if (loading && songs.length === 0) {
    return (
      <div className="song-table">
        <div className="song-head" style={{ gridTemplateColumns: gridTemplate }}>
          {columns.map((column, i) => (
            <div key={`${column.key}-${i}`} style={{ textAlign: column.align ?? 'left' }}>
              {column.label ?? ''}
            </div>
          ))}
        </div>
        <SongRowsSkeleton rows={14} columns={columns.length} />
      </div>
    )
  }

  if (!loading && songs.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
  }

  return (
    <div className="song-table">
      <div className="song-head" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((column, i) => {
          const sortable = Boolean(column.sortField && onSortChange)
          const active = Boolean(column.sortField && sort?.field === column.sortField)
          return (
            <div key={`${column.key}-${i}`} style={{ textAlign: column.align ?? 'left' }}>
              {sortable ? (
                <button
                  type="button"
                  data-active={active}
                  onClick={() => cycleSort(column.sortField!)}
                  title={`按${column.label ?? ''}排序`}
                >
                  {column.label}
                  {active ? <span>{sort?.order === 'asc' ? '↑' : '↓'}</span> : null}
                </button>
              ) : (
                (column.label ?? '')
              )}
            </div>
          )
        })}
      </div>

      {visibleSongs.map((song, index) => (
        <SongRow
          key={`${song.id}-${index}`}
          song={song}
          index={index}
          gridTemplate={gridTemplate}
          columns={columns}
          current={song.id === currentSongId}
          playing={playing}
          selected={selectionSet.has(index)}
          onPlay={() => onPlayAt(index)}
          onClick={(event) => handleRowClick(event, index)}
          onContextMenu={(event) =>
            openMenuFromEvent(event, [
              ...buildSongMenuItems(selectionSet.has(index) && selection.length > 1
                ? selection.map((i) => songs[i]).filter(Boolean)
                : [song], menuOptions),
              ...(extraMenuItems?.(song) ?? [])
            ])
          }
          onMoreClick={(event) => {
            // 多选状态下对任一选中行点「更多」，操作的是整批
            const targets = selectionSet.has(index) && selection.length > 1
              ? selection.map((i) => songs[i]).filter(Boolean)
              : [song]
            openMenuFromEvent(event, buildSongMenuItems(targets, menuOptions))
          }}
          reorderable={Boolean(onReorder)}
          dropBefore={dragOverIndex === index}
          onDragStart={() => {
            dragSource.current = index
          }}
          onDragOver={(event) => {
            if (!onReorder || dragSource.current === null) return
            event.preventDefault()
            setDragOverIndex(index)
          }}
          onDrop={() => {
            if (onReorder && dragSource.current !== null && dragSource.current !== index) {
              onReorder(dragSource.current, index)
            }
            dragSource.current = null
            setDragOverIndex(null)
          }}
          onDragEnd={() => {
            dragSource.current = null
            setDragOverIndex(null)
          }}
        />
      ))}

      {songs.length > maxRendered ? (
        <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--text-4)' }}>
          已渲染前 {maxRendered} 首，继续滚动或缩小筛选范围以查看其余 {songs.length - maxRendered} 首
        </div>
      ) : null}

      {hasMore && onLoadMore ? <InfiniteSentinel onVisible={onLoadMore} disabled={!hasMore} /> : null}
    </div>
  )
}

/* ─────────────────────────────── 单行 ─────────────────────────────── */

interface SongRowProps {
  song: Song
  index: number
  gridTemplate: string
  columns: SongColumn[]
  current: boolean
  playing: boolean
  selected: boolean
  onPlay: () => void
  onClick: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
  onMoreClick: (event: React.MouseEvent) => void
  reorderable: boolean
  dropBefore: boolean
  onDragStart: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}

function SongRow({
  song,
  index,
  gridTemplate,
  columns,
  current,
  playing,
  selected,
  onPlay,
  onClick,
  onContextMenu,
  onMoreClick,
  reorderable,
  dropBefore,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: SongRowProps): React.JSX.Element {
  const favoriteIds = usePlaylists((s) => s.favoriteIds)
  const toggleFavorite = usePlaylists((s) => s.toggleFavorite)
  const favorited = favoriteIds.has(song.id)

  const renderCell = (column: SongColumn): React.ReactNode => {
    switch (column.key) {
      case 'index':
        return (
          <div className="song-index">
            <span className="song-index-num">{index + 1}</span>
            <button
              type="button"
              className="song-index-play"
              aria-label={current && playing ? '暂停' : '播放'}
              onClick={(event) => {
                event.stopPropagation()
                onPlay()
              }}
            >
              {current && playing ? <IconPause size={13} /> : <IconPlay size={13} />}
            </button>
          </div>
        )
      case 'title':
        return (
          <div className="row" style={{ minWidth: 0 }}>
            <Cover coverUrl={song.cover_url} width={88} size={34} radius={7} />
            <div style={{ minWidth: 0 }}>
              <div className="song-title truncate">{song.title}</div>
            </div>
          </div>
        )
      case 'artist':
        return <div className="song-cell truncate">{displayArtist(song.artist)}</div>
      case 'album':
        return <div className="song-cell truncate">{displayAlbum(song.album)}</div>
      case 'added':
        return (
          <div className="song-cell truncate" style={{ fontSize: 12 }}>
            {formatRelative(song.added_at)}
          </div>
        )
      case 'duration':
        return <div className="song-duration">{song.is_live ? 'LIVE' : formatDuration(song.duration)}</div>
      default:
        return null
    }
  }

  return (
    <div
      className="song-row"
      style={{ gridTemplateColumns: gridTemplate }}
      data-current={current}
      data-selected={selected}
      data-drop-before={dropBefore}
      draggable={reorderable}
      onClick={onClick}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      onDragStart={(event) => {
        // 给侧栏歌单用的负载：拖到歌单上就能加进去
        event.dataTransfer.setData('application/x-songloft-songs', JSON.stringify([song.id]))
        event.dataTransfer.effectAllowed = 'copyMove'
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {columns.map((column, i) =>
        column.key === 'actions' ? (
          <div key="actions" className="song-actions" style={{ justifyContent: 'flex-end' }}>
            {reorderable ? (
              <span className="queue-drag" title="拖动调整顺序" style={{ width: 24 }}>
                <IconGrip size={14} />
              </span>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              data-active={favorited}
              aria-label={favorited ? '取消收藏' : '收藏'}
              title={favorited ? '取消收藏' : '收藏'}
              onClick={(event) => {
                event.stopPropagation()
                void toggleFavorite(song)
              }}
            >
              <IconHeart size={15} filled={favorited} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="更多操作"
              title="更多操作"
              onClick={(event) => {
                event.stopPropagation()
                onMoreClick(event)
              }}
            >
              <IconMore size={15} />
            </button>
          </div>
        ) : (
          <div key={`${column.key}-${i}`} style={{ minWidth: 0, textAlign: column.align ?? 'left' }}>
            {renderCell(column)}
          </div>
        )
      )}
    </div>
  )
}

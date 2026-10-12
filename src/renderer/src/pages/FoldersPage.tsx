/**
 * 按文件夹浏览。
 *
 * 后端 `/songs/folders?path=` 一次返回「当前目录 + 子文件夹 + 本目录下的歌」，
 * 所以一层一个请求，不需要自己拼路径。
 *
 * 桌面端相对移动端多做的一点：面包屑做成可点击的层级链（移动端只有返回箭头），
 * 深目录下从 `Pop/2020/Live` 跳回 `Pop` 只要一次点击。
 */

import { useMemo, useState } from 'react'

import type { Song } from '@shared/types'
import { IconFolder, IconFolderOpen, IconMusic, IconPlay, IconRefresh } from '@/components/Icons'
import { EmptyState } from '@/components/primitives'
import { SelectionBar } from '@/components/SelectionBar'
import { LIBRARY_COLUMNS, SongTable } from '@/components/SongTable'
import { getFolders } from '@/api/endpoints'
import { useAsync } from '@/hooks/useAsync'
import { requireClient } from '@/state/useAuth'
import { usePlayer } from '@/state/usePlayer'
import { useUi } from '@/state/useUi'

export function FoldersPage({ path }: { path: string }): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const playSongs = usePlayer((s) => s.playSongs)
  const [selection, setSelection] = useState<number[]>([])
  const [selectAllIds, setSelectAllIds] = useState<number[] | null>(null)

  const result = useAsync(() => getFolders(requireClient(), path), [path])
  const data = result.data

  // ?? [] 每次渲染都是新数组，会顺带把下游 useMemo 的依赖搅成"每帧必变"（等于白 memo）
  const songs = useMemo(() => data?.songs ?? [], [data])
  const folders = useMemo(() => data?.folders ?? [], [data])

  const selectedSongs = useMemo(
    () => selection.map((i) => songs[i]).filter((s): s is Song => Boolean(s)),
    [selection, songs]
  )

  const segments = useMemo(() => {
    if (!path) return [] as { label: string; path: string }[]
    const parts = path.split('/').filter(Boolean)
    return parts.map((label, index) => ({ label, path: parts.slice(0, index + 1).join('/') }))
  }, [path])

  const clearSelection = (): void => {
    setSelection([])
    setSelectAllIds(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">文件夹</h1>
          <p className="page-subtitle">
            {result.loading && !data
              ? '正在读取…'
              : `${folders.length} 个子文件夹 · ${data?.total_songs ?? 0} 首歌${path ? ` · ${path}` : ''}`}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => result.reload()}>
            <IconRefresh size={15} />
            刷新
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={songs.length === 0}
            onClick={() => void playSongs(songs, 0, { type: 'folder', key: path || '/' })}
          >
            <IconPlay size={15} />
            播放本目录
          </button>
        </div>
      </div>

      {/* ── 面包屑 ── */}
      <div className="crumbs" style={{ marginBottom: 14 }}>
        <button type="button" onClick={() => navigate({ name: 'folders', path: '' })}>
          音乐根目录
        </button>
        {segments.map((segment) => (
          <span key={segment.path} className="row" style={{ gap: 4 }}>
            <span style={{ color: 'var(--text-4)' }}>/</span>
            <button
              type="button"
              aria-current={segment.path === path}
              onClick={() => navigate({ name: 'folders', path: segment.path })}
              style={segment.path === path ? { color: 'var(--text-1)', fontWeight: 600 } : undefined}
            >
              {segment.label}
            </button>
          </span>
        ))}
      </div>

      {result.error ? (
        <div className="probe-result" data-state="error" style={{ marginBottom: 14 }}>
          <span>{result.error}</span>
          <button type="button" className="btn" data-size="sm" onClick={() => result.reload()}>
            重试
          </button>
        </div>
      ) : null}

      {/* ── 子文件夹 ── */}
      {folders.length > 0 ? (
        <div style={{ marginBottom: 18 }}>
          {folders.map((folder) => (
            <div
              key={folder.path}
              className="folder-row"
              role="button"
              tabIndex={0}
              title={folder.path}
              onClick={() => navigate({ name: 'folders', path: folder.path })}
            >
              <IconFolder size={18} />
              <span className="truncate">{folder.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{folder.song_count} 首</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── 本目录歌曲 ── */}
      <SongTable
        songs={songs}
        columns={LIBRARY_COLUMNS}
        loading={result.loading}
        onPlayAt={(index) => void playSongs(songs, index, { type: 'folder', key: path || '/' })}
        selection={selection}
        onSelectionChange={(indexes) => {
          setSelection(indexes)
          setSelectAllIds(null)
        }}
        menuOptions={{}}
        emptyTitle={folders.length > 0 ? '这个目录下没有直接的歌曲' : '这个目录是空的'}
        emptyDescription={
          folders.length > 0 ? '点上面的子文件夹继续往里看' : '去「设置 → 曲库」扫描音乐目录，或在这里新建目录后重新扫描'
        }
        emptyAction={
          folders.length === 0 ? (
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={() => navigate({ name: 'settings', section: 'library' })}
            >
              <IconFolderOpen size={15} />
              去扫描曲库
            </button>
          ) : null
        }
      />

      {songs.length === 0 && folders.length === 0 && !result.loading ? (
        <EmptyState icon={<IconMusic size={26} />} title="目录是空的" description={data?.music_path} />
      ) : null}

      {selectAllIds || selection.length > 0 ? (
        <SelectionBar
          ids={selectAllIds ?? selection.map((i) => songs[i]?.id).filter((x): x is number => x != null)}
          songs={selectAllIds ? undefined : selectedSongs}
          selectAll={Boolean(selectAllIds)}
          selectAllTotal={selectAllIds?.length}
          onClear={clearSelection}
          onRemoved={() => {
            result.reload()
            clearSelection()
          }}
        />
      ) : null}
    </div>
  )
}

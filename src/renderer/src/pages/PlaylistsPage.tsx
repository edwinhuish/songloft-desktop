/**
 * 歌单总览。
 *
 * 做成卡片网格而不是列表：封面是歌单最主要的识别信息，列表里那一小块缩略图
 * 等于把这个信息浪费掉了。卡片顺序沿用后端给的位置序（置顶在前），
 * 拖动重排不做在这里 —— 侧栏才是天天用的重排入口。
 */

import { useCallback, useMemo, useState } from 'react'

import type { Playlist } from '@shared/types'
import {
  IconEyeOff,
  IconHeart,
  IconPin,
  IconPlus,
  IconRadio,
  IconRefresh,
  IconTrash
} from '@/components/Icons'
import { CardGridSkeleton, Cover, EmptyState } from '@/components/primitives'
import { openMenuFromEvent, type MenuItem } from '@/components/ContextMenu'
import { Modal } from '@/components/Modal'
import {
  usePlaylists,
  FAVORITE_PLAYLIST_ID,
  RADIO_FAVORITE_PLAYLIST_ID
} from '@/state/usePlaylists'
import { useUi } from '@/state/useUi'
import { toast } from '@/state/useToasts'

type Filter = 'normal' | 'radio' | 'all'

export function PlaylistsPage(): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const { playlists, loading, load } = usePlaylists()
  const [filter, setFilter] = useState<Filter>('normal')
  const [showHidden, setShowHidden] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<Playlist | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const visible = useMemo(
    () => playlists.filter((p) => (filter === 'all' ? true : p.type === filter)),
    [playlists, filter]
  )

  const reload = useCallback(() => void load({ includeHidden: showHidden }), [load, showHidden])

  const handleCreate = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    const playlist = await usePlaylists.getState().create({
      type: filter === 'radio' ? 'radio' : 'normal',
      name
    })
    setCreating(false)
    setNewName('')
    if (playlist) navigate({ name: 'playlist', id: playlist.id })
  }

  const menuFor = (playlist: Playlist): MenuItem[] => [
    { key: 'header', label: playlist.name, header: true },
    { key: 'open', label: '打开', onClick: () => navigate({ name: 'playlist', id: playlist.id }) },
    {
      key: 'rename',
      label: '重命名 / 改描述',
      onClick: () => {
        setRenaming(playlist)
        setRenameDraft(playlist.name)
      }
    },
    {
      key: 'cover',
      label: '更换封面…',
      onClick: () => pickCover(playlist)
    },
    { key: 'sep-1', label: '', separator: true },
    {
      key: 'pin',
      label: playlist.pinned_at ? '取消置顶' : '置顶',
      icon: <IconPin size={15} />,
      onClick: () => void usePlaylists.getState().setPinned(playlist.id, !playlist.pinned_at)
    },
    {
      key: 'hide',
      label: '隐藏（不出现在列表里）',
      icon: <IconEyeOff size={15} />,
      onClick: () => void usePlaylists.getState().setHidden(playlist.id, true)
    },
    ...(playlist.id === FAVORITE_PLAYLIST_ID || playlist.id === RADIO_FAVORITE_PLAYLIST_ID
      ? []
      : [
          { key: 'sep-2', label: '', separator: true },
          {
            key: 'delete',
            label: '删除歌单',
            icon: <IconTrash size={15} />,
            variant: 'danger' as const,
            onClick: () => {
              if (window.confirm(`确定删除歌单「${playlist.name}」？只删歌单，不动歌曲文件。`)) {
                void usePlaylists.getState().remove(playlist.id, false)
              }
            }
          }
        ])
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">歌单</h1>
          <p className="page-subtitle">
            {loading
              ? '正在读取…'
              : `${visible.length} 个${filter === 'radio' ? '电台歌单' : '歌单'}`}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={reload}>
            <IconRefresh size={15} />
            刷新
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={() => setCreating(true)}
          >
            <IconPlus size={15} />
            新建歌单
          </button>
        </div>
      </div>

      <div className="row-between" style={{ marginBottom: 18, gap: 14, flexWrap: 'wrap' }}>
        <div className="segmented" role="group" aria-label="歌单类型">
          <button
            type="button"
            aria-pressed={filter === 'normal'}
            onClick={() => setFilter('normal')}
          >
            我的歌单
          </button>
          <button
            type="button"
            aria-pressed={filter === 'radio'}
            onClick={() => setFilter('radio')}
          >
            电台
          </button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            全部
          </button>
        </div>
        <button
          type="button"
          className="btn"
          data-size="sm"
          data-variant={showHidden ? 'primary' : 'default'}
          onClick={() => {
            const next = !showHidden
            setShowHidden(next)
            void load({ includeHidden: next })
          }}
        >
          显示隐藏的歌单
        </button>
      </div>

      {loading && playlists.length === 0 ? (
        <CardGridSkeleton cards={10} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconPlus size={26} />}
          title="这里还没有歌单"
          description="新建一个歌单，或者把歌曲行直接拖到侧栏的歌单上"
          action={
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={() => setCreating(true)}
            >
              新建歌单
            </button>
          }
        />
      ) : (
        <div className="card-grid">
          {visible.map((playlist) => (
            <div
              key={playlist.id}
              className="card"
              data-pinned={Boolean(playlist.pinned_at)}
              role="button"
              tabIndex={0}
              data-tip={playlist.name}
              onClick={() => navigate({ name: 'playlist', id: playlist.id })}
              onContextMenu={(event) => openMenuFromEvent(event, menuFor(playlist))}
            >
              <div className="card-art">
                <Cover coverUrl={playlist.cover_url} size="100%" radius={0} kind="playlist" />
              </div>
              <div className="card-title truncate row" style={{ gap: 6 }}>
                {playlist.type === 'radio' ? <IconRadio size={13} /> : null}
                {playlist.id === FAVORITE_PLAYLIST_ID ? <IconHeart size={13} filled /> : null}
                <span className="truncate">{playlist.name}</span>
              </div>
              <div className="card-meta">
                {playlist.song_count} 首
                {playlist.remote_count > 0 ? ` · 网络 ${playlist.remote_count}` : ''}
                {playlist.pinned_at ? ' · 已置顶' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <Modal
          title="新建歌单"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                data-variant="primary"
                disabled={!newName.trim()}
                onClick={() => void handleCreate()}
              >
                创建
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="playlist-create-name">
              歌单名称
            </label>
            <input
              id="playlist-create-name"
              className="input"
              autoFocus
              value={newName}
              placeholder="例如：通勤路上"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreate()
              }}
            />
          </div>
        </Modal>
      ) : null}

      {renaming ? (
        <Modal
          title="重命名歌单"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                data-variant="primary"
                disabled={!renameDraft.trim()}
                onClick={() => {
                  void usePlaylists.getState().rename(renaming.id, { name: renameDraft.trim() })
                  setRenaming(null)
                }}
              >
                保存
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="playlist-rename">
              新名称
            </label>
            <input
              id="playlist-rename"
              className="input"
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * 换封面走一个隐藏的 file input。
 * 之所以不常驻在 DOM 里：歌单可能有几十个，一人一个 input 纯属浪费；
 * 需要时才建、用完即弃。
 */
function pickCover(playlist: Playlist): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      toast('封面不能超过 8MB', 'error')
      return
    }
    void usePlaylists.getState().uploadCover(playlist.id, file)
  })
  input.click()
}

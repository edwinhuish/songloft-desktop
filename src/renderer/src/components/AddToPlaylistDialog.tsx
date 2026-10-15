/**
 * 「加入歌单」对话框。
 *
 * 由 `useUi.addToPlaylistTarget` 驱动（歌曲菜单里的「加入歌单…」写这个字段），
 * 所以对话框是全局单例 —— 不管从曲库、搜索还是队列里触发，都是同一份。
 *
 * 新建歌单直接内联在这里：原 Flutter 端要先跳去歌单页建好再回来重选，
 * 中间那次「回去重新选歌」的上下文丢失很烦。
 */

import { useMemo, useState } from 'react'

import { IconCheck, IconListMusic, IconPlus, IconSearch } from './Icons'
import { Modal } from './Modal'
import { Cover, EmptyState } from './primitives'
import { usePlaylists, FAVORITE_PLAYLIST_ID } from '@/state/usePlaylists'
import { useUi } from '@/state/useUi'
import { toast } from '@/state/useToasts'

export function AddToPlaylistDialog(): React.JSX.Element | null {
  const target = useUi((s) => s.addToPlaylistTarget)
  const close = useUi((s) => s.setAddToPlaylistTarget)
  const playlists = usePlaylists((s) => s.playlists)
  const addSongs = usePlaylists((s) => s.addSongs)
  const create = usePlaylists((s) => s.create)

  const [keyword, setKeyword] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const candidates = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return playlists
      .filter((p) => !p.labels.includes('built_in') || p.id === FAVORITE_PLAYLIST_ID)
      .filter((p) => (term ? p.name.toLowerCase().includes(term) : true))
  }, [playlists, keyword])

  if (!target || target.length === 0) return null

  const dismiss = (): void => {
    setKeyword('')
    setCreating(false)
    setNewName('')
    setBusyId(null)
    close(null)
  }

  /**
   * 加入歌单。
   *
   * ★ 这里**刻意不做可用性预检**：不逐首去试「这首歌现在放不放得出来」，也不因此把谁拦下。
   *   一首歌能不能播是**播放时**的问题（音源会过期、后台会转码、网盘可能临时抽风），
   *   加进歌单只是记一条关系 —— 在这里预检的代价是「加 200 首要发 200 个探测请求」，
   *   换来的却是把「现在恰好试不通」的歌挡在歌单外面（过一会儿它可能又好了）。
   *   真放不出来时由播放器自己换音源、连换 3 次不行再跳下一首（见 state/localPlayer）。
   *   后端也不预检：它只在返回里报 `skipped`（歌曲不存在 / 类型不适用于该歌单 / 已在歌单中）。
   */
  const handleAdd = async (playlistId: number, name: string): Promise<void> => {
    setBusyId(playlistId)
    try {
      const result = await addSongs(playlistId, target)
      toast(
        result.skipped > 0
          ? `已加入「${name}」${result.added} 首，跳过 ${result.skipped} 首（已在歌单中或不适用于该歌单）`
          : `已加入「${name}」${result.added} 首`,
        'success'
      )
      dismiss()
    } catch (error) {
      toast('加入歌单失败', 'error', error instanceof Error ? error.message : undefined)
      setBusyId(null)
    }
  }

  const handleCreateAndAdd = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    const playlist = await create({ type: 'normal', name })
    if (!playlist) return
    setCreating(false)
    setNewName('')
    await handleAdd(playlist.id, playlist.name)
  }

  return (
    <Modal
      title={`加入歌单（${target.length} 首）`}
      onClose={dismiss}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={dismiss}>
            取消
          </button>
          {creating ? (
            <button
              type="button"
              className="btn"
              data-variant="primary"
              disabled={!newName.trim()}
              onClick={() => void handleCreateAndAdd()}
            >
              创建并加入
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={() => setCreating(true)}
            >
              <IconPlus size={15} />
              新建歌单
            </button>
          )}
        </>
      }
    >
      {playlists.length > 6 ? (
        <div className="search-field" style={{ maxWidth: '100%' }}>
          <IconSearch size={15} />
          <input
            autoFocus
            value={keyword}
            placeholder="筛选歌单"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword ? (
            <button
              type="button"
              className="search-clear"
              aria-label="清除"
              onClick={() => setKeyword('')}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {creating ? (
        <div className="field">
          <label className="field-label" htmlFor="new-playlist-name">
            新歌单名称
          </label>
          <input
            id="new-playlist-name"
            className="input"
            autoFocus
            value={newName}
            placeholder="例如：深夜循环"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreateAndAdd()
              if (event.key === 'Escape') {
                event.stopPropagation()
                setCreating(false)
              }
            }}
          />
          <div className="field-hint">创建后会立刻把选中的 {target.length} 首加进去</div>
        </div>
      ) : null}

      <div style={{ maxHeight: '42vh', overflowY: 'auto', margin: '0 -6px' }}>
        {candidates.length === 0 ? (
          <EmptyState
            icon={<IconListMusic size={24} />}
            title={keyword ? '没有匹配的歌单' : '还没有歌单'}
            description={keyword ? '换个关键词，或直接新建一个' : '点下方「新建歌单」'}
          />
        ) : (
          candidates.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className="palette-item"
              disabled={busyId !== null}
              style={{ height: 52, padding: '0 6px' }}
              onClick={() => void handleAdd(playlist.id, playlist.name)}
            >
              <Cover
                coverUrl={playlist.cover_url}
                width={64}
                size={36}
                radius={8}
                kind="playlist"
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ fontSize: 13.5 }}>
                  {playlist.name}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                  {playlist.id === FAVORITE_PLAYLIST_ID
                    ? '我喜欢的音乐'
                    : `${playlist.song_count} 首`}
                </div>
              </div>
              {busyId === playlist.id ? <IconCheck size={15} /> : null}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

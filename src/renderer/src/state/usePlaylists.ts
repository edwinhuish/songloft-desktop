/**
 * 歌单 + 收藏。
 *
 * 收藏在原实现里就是内置歌单（`AppConstants.favoritePlaylistId = '1'`），
 * 所以这里不另造一套：收藏 = 往 playlist 1 加歌 / 从 playlist 1 移除，
 * 本地维护一份 id 集合用于「已收藏」高亮。
 */

import { create } from 'zustand'

import type { Playlist, PlaylistType, Song } from '@shared/types'
import {
  addSongsToPlaylist,
  batchDeletePlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylistSongIds,
  getPlaylists,
  removeSongFromPlaylist,
  setPlaylistPinned,
  setPlaylistVisibility,
  updatePlaylist,
  uploadPlaylistCover
} from '@/api/endpoints'
import { requireClient } from './useAuth'
import { toast } from './useToasts'

/** 后端内置的收藏歌单 id（songloft 后端约定） */
export const FAVORITE_PLAYLIST_ID = 1
/** 内置电台收藏歌单 id */
export const RADIO_FAVORITE_PLAYLIST_ID = 2

/**
 * 能否删除这个歌单。
 *
 * 两个内置收藏歌单后端不给删，所以「有没有删除入口」「多选里能不能勾上」「全选圈哪些」
 * 都要按这一个口径判断 —— 散成三处判断的话，迟早有一处漏掉，用户勾上了却删不掉。
 */
export function isDeletablePlaylist(playlist: Pick<Playlist, 'id'>): boolean {
  return playlist.id !== FAVORITE_PLAYLIST_ID && playlist.id !== RADIO_FAVORITE_PLAYLIST_ID
}

interface PlaylistState {
  playlists: Playlist[]
  favoriteIds: Set<number>
  loading: boolean
  error: string | null

  load: (options?: { silent?: boolean; includeHidden?: boolean }) => Promise<void>
  loadFavorites: () => Promise<void>
  create: (payload: {
    type: PlaylistType
    name: string
    description?: string
  }) => Promise<Playlist | null>
  rename: (id: number, payload: { name?: string; description?: string }) => Promise<void>
  remove: (id: number, deleteSongs: boolean) => Promise<void>
  /** 多选删除。返回是否真的删掉了，让调用方决定要不要清空选择 */
  removeMany: (ids: number[], deleteSongs?: boolean) => Promise<boolean>
  uploadCover: (id: number, file: File) => Promise<void>
  setPinned: (id: number, pinned: boolean) => Promise<void>
  setHidden: (id: number, hidden: boolean) => Promise<void>
  addSongs: (id: number, songIds: number[]) => Promise<{ added: number; skipped: number }>
  removeSong: (id: number, songId: number) => Promise<void>
  isFavorite: (songId: number) => boolean
  toggleFavorite: (song: Song) => Promise<void>
  /** 按 id 直接设置收藏态（批量操作时只拿得到 id，没有 Song 对象） */
  setFavorite: (songId: number, favorited: boolean) => Promise<void>
}

export const usePlaylists = create<PlaylistState>((set, get) => ({
  playlists: [],
  favoriteIds: new Set<number>(),
  loading: false,
  error: null,

  load: async (options = {}) => {
    if (!options.silent) set({ loading: true })
    try {
      // 默认由后端筛掉隐藏歌单；歌单页打开「显示隐藏」时才要全量
      const res = await getPlaylists(requireClient(), {
        limit: 200,
        excludeLabels: options.includeHidden ? 'none' : undefined
      })
      set({
        playlists: [...res.playlists].sort((a, b) => {
          // 置顶优先，其余按后端给出的顺序（后端已按 position 排好）
          if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1
          return 0
        }),
        loading: false,
        error: null
      })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '歌单加载失败' })
    }
  },

  loadFavorites: async () => {
    try {
      const ids = await getPlaylistSongIds(requireClient(), FAVORITE_PLAYLIST_ID)
      set({ favoriteIds: new Set(ids) })
    } catch {
      // 收藏歌单可能不存在（用户删过），静默即可
    }
  },

  create: async (payload) => {
    try {
      const playlist = await createPlaylist(requireClient(), payload)
      await get().load({ silent: true })
      toast(`已创建歌单「${playlist.name}」`, 'success')
      return playlist
    } catch (error) {
      toast('创建歌单失败', 'error', error instanceof Error ? error.message : undefined)
      return null
    }
  },

  rename: async (id, payload) => {
    try {
      const updated = await updatePlaylist(requireClient(), id, payload)
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
      toast('已保存', 'success')
    } catch (error) {
      toast('保存失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  remove: async (id, deleteSongs) => {
    try {
      await deletePlaylist(requireClient(), id, deleteSongs)
      set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }))
      toast('歌单已删除', 'success')
    } catch (error) {
      toast('删除失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  removeMany: async (ids, deleteSongs = false) => {
    // 内置收藏删不掉：调用方「全选」时可能把它们一并带上，这里兜住而不是信任调用方
    const targets = ids.filter((id) => isDeletablePlaylist({ id }))
    if (targets.length === 0) return false
    try {
      await batchDeletePlaylists(requireClient(), targets, deleteSongs)
      const removed = new Set(targets)
      set((state) => ({ playlists: state.playlists.filter((p) => !removed.has(p.id)) }))
      toast(`已删除 ${targets.length} 个歌单`, 'success')
      return true
    } catch (error) {
      toast('删除失败', 'error', error instanceof Error ? error.message : undefined)
      return false
    }
  },

  uploadCover: async (id, file) => {
    try {
      const updated = await uploadPlaylistCover(requireClient(), id, file)
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
      toast('封面已更新', 'success')
    } catch (error) {
      toast('封面上传失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  setPinned: async (id, pinned) => {
    try {
      const updated = await setPlaylistPinned(requireClient(), id, pinned)
      set((state) => ({
        playlists: state.playlists
          .map((p) => (p.id === id ? updated : p))
          .sort((a, b) => {
            if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1
            return 0
          })
      }))
    } catch (error) {
      toast('操作失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  setHidden: async (id, hidden) => {
    try {
      await setPlaylistVisibility(requireClient(), id, hidden)
      await get().load({ silent: true })
      toast(hidden ? '已隐藏该歌单' : '已取消隐藏', 'success')
    } catch (error) {
      toast('操作失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  addSongs: async (id, songIds) => {
    const result = await addSongsToPlaylist(requireClient(), id, songIds)
    if (id === FAVORITE_PLAYLIST_ID) {
      set((state) => {
        const next = new Set(state.favoriteIds)
        for (const songId of songIds) next.add(songId)
        return { favoriteIds: next }
      })
    }
    void get().load({ silent: true })
    return result
  },

  removeSong: async (id, songId) => {
    try {
      await removeSongFromPlaylist(requireClient(), id, songId)
      if (id === FAVORITE_PLAYLIST_ID) {
        set((state) => {
          const next = new Set(state.favoriteIds)
          next.delete(songId)
          return { favoriteIds: next }
        })
      }
    } catch (error) {
      toast('移除失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  isFavorite: (songId) => get().favoriteIds.has(songId),

  setFavorite: async (songId, favorited) => {
    const id = FAVORITE_PLAYLIST_ID
    const before = get().favoriteIds.has(songId)
    if (before === favorited) return
    // 乐观更新：点一下要立刻有反馈，失败了再回滚
    set((state) => {
      const next = new Set(state.favoriteIds)
      if (favorited) next.add(songId)
      else next.delete(songId)
      return { favoriteIds: next }
    })
    try {
      if (favorited) await addSongsToPlaylist(requireClient(), id, [songId])
      else await removeSongFromPlaylist(requireClient(), id, songId)
    } catch (error) {
      set((state) => {
        const next = new Set(state.favoriteIds)
        if (favorited) next.delete(songId)
        else next.add(songId)
        return { favoriteIds: next }
      })
      toast(
        favorited ? '收藏失败' : '取消收藏失败',
        'error',
        error instanceof Error ? error.message : undefined
      )
    }
  },

  toggleFavorite: async (song) => {
    await get().setFavorite(song.id, !get().favoriteIds.has(song.id))
  }
}))

/**
 * 「我的歌单」：用户自己建的普通歌单。
 *
 * ★ 侧栏与标题栏折叠菜单都用它 —— 同一个名单出现两处，不共用过滤条件的话迟早各自漂移
 *   （电台收藏与后端打上 built_in 标签的内置歌单都不进导航）。
 */
export function regularPlaylists(playlists: Playlist[]): Playlist[] {
  return playlists.filter((p) => p.type === 'normal' && !p.labels.includes('built_in'))
}

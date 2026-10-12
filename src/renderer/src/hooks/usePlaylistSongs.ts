/**
 * 歌单内歌曲的分页加载。
 *
 * 与 `useSongList` 分开写，因为这两件事的语义不同：
 *   * `useSongList` 打的是 `/songs`（曲库全局筛选）
 *   * 这里打 `/playlists/{id}/songs`（歌单内有序列表，支持服务端排序与关键词）
 *
 * 需要单独一份的另一个原因是 `fetchAllIds` 走的是 `/song-ids` —— 歌单可重排，
 * 全量 id 的顺序就是「加入歌单」时的顺序，批量重排要用到。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Song } from '@shared/types'
import { getPlaylistSongIds, getPlaylistSongs } from '@/api/endpoints'
import { requireClient } from '@/state/useAuth'

export interface PlaylistSongsController {
  songs: Song[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
  /** 就地替换（编辑元数据后） */
  patchSong: (song: Song) => void
  removeSongs: (ids: number[]) => void
  /** 就地重排（拖动后调用，避免整表刷新丢掉滚动位置） */
  setSongs: (songs: Song[]) => void
  fetchAllIds: () => Promise<number[]>
}

export interface PlaylistSongsOptions {
  sort?: string
  order?: 'asc' | 'desc'
  keyword?: string
  pageSize?: number
}

export function usePlaylistSongs(
  playlistId: number,
  options: PlaylistSongsOptions = {}
): PlaylistSongsController {
  const { sort, order, keyword, pageSize = 200 } = options
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generation = useRef(0)
  const key = JSON.stringify([playlistId, sort, order, keyword])

  const load = useCallback(
    async (offset: number, token: number) => {
      try {
        const result = await getPlaylistSongs(requireClient(), playlistId, {
          limit: pageSize,
          offset,
          sort,
          order,
          keyword: keyword || undefined
        })
        if (token !== generation.current) return
        setSongs((prev) => {
          if (offset === 0) return result.songs
          const seen = new Set(prev.map((s) => s.id))
          return [...prev, ...result.songs.filter((s) => !seen.has(s.id))]
        })
        setTotal(result.total)
        setError(null)
      } catch (err) {
        if (token !== generation.current) return
        setError(err instanceof Error ? err.message : '加载失败')
      }
    },
    // key 已经把 playlistId/sort/order/keyword 串起来了，避免对象引用导致的无限重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, pageSize]
  )

  useEffect(() => {
    const token = ++generation.current
    setLoading(true)
    setSongs([])
    setTotal(0)
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
    return () => {
      generation.current += 1
    }
  }, [load])

  const loadMore = useCallback(() => {
    if (loading || loadingMore) return
    setLoadingMore(true)
    const token = generation.current
    void load(songs.length, token).finally(() => {
      if (token === generation.current) setLoadingMore(false)
    })
  }, [load, loading, loadingMore, songs.length])

  const refresh = useCallback(() => {
    const token = ++generation.current
    setLoading(true)
    setSongs([])
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
  }, [load])

  const patchSong = useCallback((song: Song) => {
    setSongs((prev) => prev.map((s) => (s.id === song.id ? song : s)))
  }, [])

  const removeSongs = useCallback((ids: number[]) => {
    const remove = new Set(ids)
    setSongs((prev) => prev.filter((s) => !remove.has(s.id)))
    setTotal((prev) => Math.max(0, prev - ids.length))
  }, [])

  const fetchAllIds = useCallback(
    () => getPlaylistSongIds(requireClient(), playlistId, { sort, order }),
    [playlistId, sort, order]
  )

  return {
    songs,
    total,
    loading,
    loadingMore,
    error,
    hasMore: songs.length < total,
    loadMore,
    refresh,
    patchSong,
    removeSongs,
    setSongs,
    fetchAllIds
  }
}

/**
 * 歌单内歌曲的分页加载。
 *
 * 与 `useSongList` 分开写，因为这两件事的语义不同：
 *   * `useSongList` 打的是 `/songs`（曲库全局筛选）
 *   * 这里打 `/playlists/{id}/songs`（歌单内有序列表，支持服务端排序与关键词）
 *
 * 需要单独一份的另一个原因是 `fetchAllIds` 走的是 `/song-ids` —— 歌单可重排，
 * 全量 id 的顺序就是「加入歌单」时的顺序，批量重排要用到。
 *
 * 「切回本页时静默刷新」的取舍与 `useSongList` 完全一致（见那里的说明），不在这里重述。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { sameData } from '@shared/data'
import type { Song } from '@shared/types'
import { getPlaylistSongIds, getPlaylistSongs } from '@/api/endpoints'
import { requireClient } from '@/state/useAuth'
import { useLibrary } from '@/state/useLibrary'
import { usePageActive } from './usePageActive'

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
  /* 曲库数据的版本号（扫描 / 刷新元数据结束后 +1，见 state/useLibrary）—— 与 useSongList 同款 */
  const revision = useLibrary((s) => s.revision)
  /** 所在的页面槽是不是看得见的那一页（见 usePageActive）：切回来要重取一次 */
  const active = usePageActive()

  /** 手头这份列表的镜像：静默刷新与去重都要拿它比对（state 在闭包里是过期的那一份） */
  const songsRef = useRef<Song[]>([])
  const totalRef = useRef(0)
  /** 上一次请求的条件指纹；与这次相同 → 只因切回本页而重跑，走静默路径 */
  const lastKey = useRef<string | null>(null)

  const commit = useCallback((next: Song[]) => {
    songsRef.current = next
    setSongs(next)
  }, [])

  const load = useCallback(
    async (offset: number, token: number, silent = false) => {
      try {
        const result = await getPlaylistSongs(requireClient(), playlistId, {
          limit: pageSize,
          offset,
          sort,
          order,
          keyword: keyword || undefined
        })
        if (token !== generation.current) return

        if (silent) {
          const unchanged =
            totalRef.current === result.total &&
            sameData(songsRef.current.slice(0, pageSize), result.songs)
          if (unchanged) return
          totalRef.current = result.total
          commit(result.songs)
          setTotal(result.total)
        } else {
          const previous = songsRef.current
          const seen = new Set(previous.map((s) => s.id))
          const next =
            offset === 0
              ? result.songs
              : [...previous, ...result.songs.filter((s) => !seen.has(s.id))]
          totalRef.current = result.total
          commit(next)
          setTotal(result.total)
        }
        setError(null)
      } catch (err) {
        if (token !== generation.current) return
        // 静默刷新失败不冒泡：手头这份还能用，别为一次后台动作在页面上弹红字
        if (silent) return
        setError(err instanceof Error ? err.message : '加载失败')
      }
    },
    // key 已经把 playlistId/sort/order/keyword 串起来了，避免对象引用导致的无限重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, pageSize, commit]
  )

  useEffect(() => {
    // 被藏起来的页面不发请求；切回来时 active 从 false 变 true，这个 effect 重跑
    if (!active) return

    const requestKey = JSON.stringify([key, pageSize, revision])
    const silent = requestKey === lastKey.current
    lastKey.current = requestKey
    const token = ++generation.current

    if (silent) {
      void load(0, token, true)
      return
    }

    setLoading(true)
    commit([])
    totalRef.current = 0
    setTotal(0)
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
    return () => {
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, pageSize, revision, load])

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
    commit([])
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
  }, [load, commit])

  const patchSong = useCallback(
    (song: Song) => {
      commit(songsRef.current.map((s) => (s.id === song.id ? song : s)))
    },
    [commit]
  )

  const removeSongs = useCallback(
    (ids: number[]) => {
      const remove = new Set(ids)
      commit(songsRef.current.filter((s) => !remove.has(s.id)))
      totalRef.current = Math.max(0, totalRef.current - ids.length)
      setTotal(totalRef.current)
    },
    [commit]
  )

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
    setSongs: commit,
    fetchAllIds
  }
}

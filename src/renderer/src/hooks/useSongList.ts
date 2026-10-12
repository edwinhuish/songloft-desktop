/**
 * 分页歌曲列表。
 *
 * 三个必须处理的点：
 *   1. 请求竞态：筛选条件一变，在途的旧请求必须作废（否则慢的旧响应会盖掉新结果）
 *   2. 累加去重：同一首歌不该因为 offset 漂移出现两次
 *   3. 卸载安全：切页面时不再 setState
 *
 * 「加载全部 ID」单独给一个方法：批量操作（全选加歌单）不该把几千首歌拉进内存，
 * 后端有 `/songs/ids` 只返回 id。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Song, SongQuery } from '@shared/types'
import { getSongIds, getSongs } from '@/api/endpoints'
import { requireClient } from '@/state/useAuth'

export interface SongListController {
  songs: Song[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
  /** 就地替换某首歌（编辑元数据后避免整表刷新） */
  patchSong: (song: Song) => void
  removeSongs: (ids: number[]) => void
  /** 取当前筛选条件下的全部 id（用于批量操作） */
  fetchAllIds: () => Promise<number[]>
  /** 已加载的页码（从 0 开始），调试用 */
  pages: number
}

export function useSongList(query: SongQuery, pageSize = 200): SongListController {
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState(0)

  const generation = useRef(0)
  const queryKey = JSON.stringify(query)

  const load = useCallback(
    async (offset: number, generationToken: number) => {
      try {
        const result = await getSongs(requireClient(), { ...query, limit: pageSize, offset })
        if (generationToken !== generation.current) return
        setSongs((prev) => {
          if (offset === 0) return result.songs
          const seen = new Set(prev.map((s) => s.id))
          return [...prev, ...result.songs.filter((s) => !seen.has(s.id))]
        })
        setTotal(result.total)
        setPages(Math.floor(offset / pageSize) + 1)
        setError(null)
      } catch (err) {
        if (generationToken !== generation.current) return
        setError(err instanceof Error ? err.message : '加载失败')
      }
    },
    // query 通过 queryKey 参与依赖；直接放 query 对象会因每次渲染新引用而无限重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, pageSize]
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

  const fetchAllIds = useCallback(async () => getSongIds(requireClient(), query), [query])

  const hasMore = songs.length < total

  return {
    songs,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    patchSong,
    removeSongs,
    fetchAllIds,
    pages
  }
}

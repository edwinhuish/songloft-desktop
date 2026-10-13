/**
 * 分页歌曲列表。
 *
 * 四个必须处理的点：
 *   1. 请求竞态：筛选条件一变，在途的旧请求必须作废（否则慢的旧响应会盖掉新结果）
 *   2. 累加去重：同一首歌不该因为 offset 漂移出现两次
 *   3. 卸载安全：切页面时不再 setState
 *   4. 切回本页时的**静默刷新**：重取一次，数据没变就一个字都不改（见下面那段说明）
 *
 * 「加载全部 ID」单独给一个方法：批量操作（全选加歌单）不该把几千首歌拉进内存，
 * 后端有 `/songs/ids` 只返回 id。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { sameData } from '@shared/data'
import type { Song, SongQuery } from '@shared/types'
import { getSongIds, getSongs } from '@/api/endpoints'
import { requireClient } from '@/state/useAuth'
import { useLibrary } from '@/state/useLibrary'
import { usePageActive } from './usePageActive'

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
  /*
   * 曲库数据的版本号（扫描 / 刷新元数据结束后 +1，见 state/useLibrary）。
   * 放进下面那个 effect 的依赖里 → 与手动点「刷新」同一条路径
   * （已加载的分页会退回第一页，这是「数据变了」该有的代价）。
   */
  const revision = useLibrary((s) => s.revision)
  /** 所在的页面槽是不是看得见的那一页（见 usePageActive）：切回来要重取一次 */
  const active = usePageActive()

  /** 手头这份列表的镜像：静默刷新与去重都要拿它比对（state 在闭包里是过期的那一份） */
  const songsRef = useRef<Song[]>([])
  const totalRef = useRef(0)
  /** 上一次请求的条件指纹；与这次相同 → 只因切回本页而重跑，走静默路径 */
  const lastKey = useRef<string | null>(null)

  const commit = useCallback((next: Song[], nextTotal: number, loadedPages: number) => {
    songsRef.current = next
    totalRef.current = nextTotal
    setSongs(next)
    setTotal(nextTotal)
    setPages(loadedPages)
  }, [])

  /**
   * @param silent 切回本页时的静默刷新：只重取第一页与手头这份比，
   *   一样就**什么都不做**（已加载的后续页、滚动位置、选中态全留着）；
   *   不一样才换掉（退回第一页 —— 与手动点「刷新」同一条路径）。
   *   只比第一页是刻意的取舍：要覆盖已加载的 N 页就得再拉 N 页（用户点过十几次
   *   「加载更多」时这个代价不小），而「第一页与总数都没变、后面却变了」极罕见。
   */
  const load = useCallback(
    async (offset: number, generationToken: number, silent = false) => {
      try {
        const result = await getSongs(requireClient(), { ...query, limit: pageSize, offset })
        if (generationToken !== generation.current) return
        // 取回来了就先清掉可能残留的错误提示：数据是好的，那条红字不该继续挂着
        setError(null)

        if (silent) {
          const unchanged =
            totalRef.current === result.total &&
            sameData(songsRef.current.slice(0, pageSize), result.songs)
          if (unchanged) return
          commit(result.songs, result.total, 1)
        } else {
          const previous = songsRef.current
          if (offset === 0) {
            commit(result.songs, result.total, 1)
          } else {
            const seen = new Set(previous.map((s) => s.id))
            const merged = [...previous, ...result.songs.filter((s) => !seen.has(s.id))]
            commit(merged, result.total, Math.floor(offset / pageSize) + 1)
          }
        }
      } catch (err) {
        if (generationToken !== generation.current) return
        // 静默刷新失败不冒泡：手头这份还能用，别为一次后台动作在页面上弹红字
        if (silent) return
        setError(err instanceof Error ? err.message : '加载失败')
      }
    },
    // query 通过 queryKey 参与依赖；直接放 query 对象会因每次渲染新引用而无限重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, pageSize, commit]
  )

  useEffect(() => {
    // 被藏起来的页面不发请求；切回来时 active 从 false 变 true，这个 effect 重跑
    if (!active) return

    const key = JSON.stringify([queryKey, pageSize, revision])
    const silent = key === lastKey.current
    lastKey.current = key
    const token = ++generation.current

    if (silent) {
      void load(0, token, true)
      return
    }

    setLoading(true)
    commit([], 0, 0)
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
    return () => {
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queryKey, pageSize, revision, load])

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
    commit([], 0, 0)
    void load(0, token).finally(() => {
      if (token === generation.current) setLoading(false)
    })
  }, [load, commit])

  const patchSong = useCallback((song: Song) => {
    const next = songsRef.current.map((s) => (s.id === song.id ? song : s))
    songsRef.current = next
    setSongs(next)
  }, [])

  const removeSongs = useCallback((ids: number[]) => {
    const remove = new Set(ids)
    const next = songsRef.current.filter((s) => !remove.has(s.id))
    songsRef.current = next
    totalRef.current = Math.max(0, totalRef.current - ids.length)
    setSongs(next)
    setTotal(totalRef.current)
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

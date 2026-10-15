/**
 * 歌单 + 收藏。
 *
 * 收藏在原实现里就是内置歌单（`AppConstants.favoritePlaylistId = '1'`），
 * 所以这里不另造一套：收藏 = 往 playlist 1 加歌 / 从 playlist 1 移除，
 * 本地维护一份 id 集合用于「已收藏」高亮。
 *
 * ★ 这份列表的新鲜度由「谁在看」决定：歌单页重新被看见时自己静默刷新一次
 *   （见 hooks/usePageActive 与 pages/PlaylistsPage）。这个 store 负责的是那一趟的
 *   三条底线 —— **不重复发**（同条件在途就搭车）、**不覆盖更新的结果**（旧响应作废）、
 *   **内容没变就一个字都不改**（不重渲染、不留加载态、不冒泡错误）。见 load。
 */

import { create } from 'zustand'

import { sameData } from '@shared/data'
import { applyPlaylistOrder, sortPinnedFirst } from '@shared/playlist'
import type { Playlist, PlaylistType, Song } from '@shared/types'
import {
  addSongsToPlaylist,
  batchDeletePlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylistSongIds,
  getPlaylists,
  removeSongFromPlaylist,
  reorderPlaylists,
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
  /** 按拖动后的顺序重排（侧栏）。入参是**看得见的那一份** id 序列 */
  reorder: (ids: number[]) => Promise<void>
  addSongs: (id: number, songIds: number[]) => Promise<{ added: number; skipped: number }>
  removeSong: (id: number, songId: number) => Promise<void>
  isFavorite: (songId: number) => boolean
  toggleFavorite: (song: Song) => Promise<void>
  /** 按 id 直接设置收藏态（批量操作时只拿得到 id，没有 Song 对象） */
  setFavorite: (songId: number, favorited: boolean) => Promise<void>
}

/**
 * 在途的取数，按「条件」分格（见 load）：同一个条件正在路上时，后来者搭车。
 *
 * ★ 为什么要去重：`load()` 的调用点有七八处 —— 启动编排、侧栏挂载、歌单页切回来、
 *   好几处增删改之后的补齐，任意两处都可能在同一个瞬间叫出来。它们要的是同一份结果，
 *   发两趟纯属白跑（而且两趟各自 set 一次，界面还平白多渲染一轮）。
 * ★ 只去重**网络那一趟**，提交与否仍由每个调用方自己定（见 load 的 try 块）——
 *   若连提交也一起搭车，两个调用点各自的 silent / loading 口径就被搅在一起了
 *   （比如非静默的那次会因为车里本来是个静默请求而收不掉「正在读取…」）。
 */
const inFlight = new Map<string, { id: number; promise: Promise<Playlist[]> }>()
let fetchId = 0

/** 取歌单列表。条件 = 要不要含隐藏歌单：那是两份不同的结果，谁也不能替谁 */
function fetchPlaylists(key: string, includeHidden?: boolean): Promise<Playlist[]> {
  const pending = inFlight.get(key)
  if (pending) return pending.promise

  const id = ++fetchId
  const promise = getPlaylists(requireClient(), {
    limit: 200,
    // 默认由后端筛掉隐藏歌单；歌单页打开「显示隐藏」时才要全量
    excludeLabels: includeHidden ? 'none' : undefined
  })
    // 置顶优先，其余按后端给出的顺序（后端已按 position 排好）
    .then((res) => sortPinnedFirst(res.playlists))

  // 收工后清掉自己那一格。只清自己：中途被顶掉时，那一格已经属于新请求了
  const release = (): void => {
    if (inFlight.get(key)?.id === id) inFlight.delete(key)
  }
  inFlight.set(key, { id, promise })
  // 成功失败都要清（第二个参数是失败分支）：漏了失败那条，这一格会一直堵着
  void promise.then(release, release)
  return promise
}

/**
 * 最近一次**取回来**的条件（要不要含隐藏歌单）。
 *
 * ★ 为什么要有它：`load()` 有一半调用点对条件没有意见（新建 / 隐藏之后的顺手补齐、
 *   后台任务结束后的 invalidate、启动编排），它们原来一律按「不含隐藏」去取 ——
 *   而歌单页当时可能正开着「显示隐藏的歌单」，于是一次新建就让隐藏歌单从列表里消失了，
 *   而那颗开关还亮着，看起来就像刷新把数据弄丢了。记住它、没明说就沿用：取数的条件
 *   跟着用户最后选的那一份走（歌单页那颗开关自己会明说，这条只兜住没说的人）。
 * ★ 只在**取回来**时才记：失败与作废的都不算 —— 这份列表是哪份条件取的，就记哪一份。
 */
let condition = false

/**
 * 全局请求序号（见 load）。
 *
 * 响应回来的顺序不一定与发出去的一致（先发的可能后到），而只有**最后**发出去的那一次
 * 代表用户现在要的东西。旧的一律不许再往 store 里写 —— 否则在歌单页来回切「显示隐藏的
 * 歌单」时，慢的那条回来会把界面盖成上一次的筛选结果。
 */
let sequence = 0

export const usePlaylists = create<PlaylistState>((set, get) => ({
  playlists: [],
  favoriteIds: new Set<number>(),
  loading: false,
  error: null,

  /**
   * @param options.silent 静默刷新（切回歌单页时走这条）：不显示加载态，**内容没变就一个字
   *   都不改**，失败也不往界面上冒泡 —— 与 useAsync / useSongList / usePlaylistSongs 同一条口径。
   * @param options.includeHidden 要不要含隐藏歌单。歌单页那颗「显示隐藏」开关由它自己明说；
   *   别的调用点不说就沿用上一次取回来的那一份（见 condition），免得把当前列表换成另一份条件的。
   */
  load: async (options = {}) => {
    const silent = options.silent === true
    const includeHidden = options.includeHidden ?? condition
    /** 条件指纹：去重与「作废旧响应」都按它分格 */
    const key = includeHidden ? 'all' : 'default'
    const mine = ++sequence
    if (!silent) set({ loading: true })
    try {
      const next = await fetchPlaylists(key, includeHidden)
      // 已经有更新的一次出发了（多为又切了一次条件）：这份结果作废，别覆盖它
      if (mine !== sequence) return
      const state = get()
      /*
       * 静默刷新 + 内容一模一样 + 此前没留下错误：**一个字都不改**。
       * 这正是「切回来还是离开时的样子」要的那一下：列表、滚动位置、页内筛选、勾选全留着，
       * 连一次多余的渲染都没有。有错误残留时反而要提交 —— 数据是好的，那条红字不该继续挂着。
       */
      if (silent && state.error === null && sameData(state.playlists, next)) {
        condition = includeHidden
        return
      }
      condition = includeHidden
      set({ playlists: next, loading: false, error: null })
    } catch (error) {
      if (mine !== sequence) return
      // 静默刷新失败不冒泡：手头这份还能用，下次切回来再试（不该为一次后台动作弹红字）
      if (silent) return
      set({ loading: false, error: error instanceof Error ? error.message : '歌单加载失败' })
    } finally {
      /*
       * 「正在读取」的收口：手上已经没有在途请求了，就不该还挂着它。
       * 需要这一条是因为加载态由**发起的那一趟**点亮，而它可能被后来的静默一趟顶掉 ——
       * 静默那趟自己从不点亮它，于是没人收，界面会一直停在「正在读取…」。
       */
      if (inFlight.size === 0 && get().loading) set({ loading: false })
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
        playlists: sortPinnedFirst(state.playlists.map((p) => (p.id === id ? updated : p)))
      }))
    } catch (error) {
      toast('操作失败', 'error', error instanceof Error ? error.message : undefined)
    }
  },

  /**
   * 侧栏拖动后的重排。
   *
   * ★ 入参是**侧栏列出来的那一份**（「我的歌单」），隐藏歌单与两个内置收藏都不在里面 ——
   *   服务端对未纳入的 id 保持原槽位（songloft#266），与 shared/playlist 的
   *   applyPlaylistOrder 是同一条口径，所以本地先渲染出来的那份和服务端存下的一致。
   * ★ 先本地生效再发请求：拖完立刻看到结果，网络慢也不会「弹回去」；失败原样退回来。
   */
  reorder: async (ids) => {
    const previous = get().playlists
    const next = sortPinnedFirst(applyPlaylistOrder(previous, ids))
    set({ playlists: next })
    try {
      // 发回**最终显示的那份**顺序。拖进置顶块里的项会被置顶规则拉回块后，服务端该存下的
      // 是用户看到的那个样子 —— 否则下次刷新它自己跳一下，看起来就像「顺序没保存」。
      await reorderPlaylists(
        requireClient(),
        regularPlaylists(next).map((playlist) => playlist.id)
      )
    } catch (error) {
      set({ playlists: previous })
      toast('歌单顺序保存失败', 'error', error instanceof Error ? error.message : undefined)
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

  /**
   * 往歌单里加歌。
   *
   * ★ 不做可用性预检：只把 id 交给后端，不逐首探测「能不能播」。能不能播是**播放时**的问题
   *   （音源会过期、后台会转码、网盘会临时抽风），而加歌只是记一条关系 —— 预检会把「此刻
   *   恰好试不通」的歌挡在歌单外，代价却是加 N 首发 N 个请求。放不出来时由播放器换源重试
   *   （见 state/player-core 的 error 处理），连换 3 次不行才跳下一首。
   *   后端的 `skipped` 是「歌曲不存在 / 类型不适用于该歌单 / 已在歌单中」，与能不能播无关。
   */
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
    /*
     * 本地文件不在曲库里（id 为负，见 shared/local-file）：拿它去问后端只会 404。
     * 界面上这些动作本来也不会为它出现（见 buildSongMenuItems），这里再拦一道 —— 键盘的
     * `f`、播放条与托盘那几处入口都只拿得到一个 id，防不住「某一处漏了判断」。
     */
    if (songId <= 0) return
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

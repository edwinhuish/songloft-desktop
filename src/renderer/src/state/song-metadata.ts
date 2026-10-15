/**
 * 播放时的**元数据补齐**。
 *
 * 要解决的问题：一首歌真正开始播之前，客户端手里那份 `Song` 是「从列表接口拿来的」，
 * 它可能缺封面、缺歌词、缺歌手 / 歌名（音频文件里没内嵌、或者音源那边当时没给全）。
 * 缺的那几项**不必等用户去设置页点一次「刷新元数据」**：起播时就该自己去问一次。
 *
 * 三条边界，决定了这个模块的形状：
 *
 *   1. **只补缺失，不问已有的**。先按 `findMetadataGaps` 判一次缺口，没有缺口就一个请求都不发；
 *      发出去之后也只把缺的那几项合并进来（`mergeMetadata`），不覆盖手上已有的字段 ——
 *      用户手改过的标签不能被「刷新」擦掉。
 *   2. **两条路，先客户端后服务端**。客户端能做的只有「再问一次后端要这首歌」（`GET /songs/{id}`）
 *      —— 服务端可能在这期间已经把内嵌标签 / 缓存回填做好了。连它也给不出新东西时，才去请
 *      **服务端**跑一次元数据补齐（`POST /songs/refresh-metadata`）—— 那一步要读音频文件、
 *      动辄几分钟，只能交给它后台做，做完由 useLibrary 的守望收口（号 +1 → 各处的副本重取）。
 *   3. **失败要能降级，且不刷屏**。请求失败就用手上这份（界面另有降级显示：封面退到
 *      `source_cover_url`、标题退到文件名，见 shared/metadata.ts），并且把这次失败**记账**，
 *      一小段时间内不再为同一首歌重复问 —— 否则后端挂掉时每切一首歌都要白等一次超时。
 *
 * ★ 与 `useLibrary.invalidate()` 的分工：那边是「服务端任务跑完了，把各处的副本刷新一遍」，
 *   这边是「起播时发现缺东西，主动去问」。两者都会换掉队列里那一份 Song，但都要遵守同一条
 *   规矩：**只换队列里那一个对象，不动 order / cursor，也不碰 audio**（正在播的音频不该因为
 *   元数据到达而中断）。
 */

import { create } from 'zustand'

import type { Song } from '@shared/types'
import { filled, findMetadataGaps, metadataCacheKey, mergeMetadata } from '@shared/metadata'
import { getSong, startMetadataRefresh } from '@/api/endpoints'
import { requireClient } from './useAuth'
import { useLibrary } from './useLibrary'
import { usePlayer } from './usePlayer'

/**
 * 客户端查询的超时。
 *
 * 比 client 的默认值（15s）短：这是**后台补齐**，不是用户正等着的动作 —— 宁可早点放弃、
 * 由服务端那条路兜底，也不要让一个悬着的请求连着占住「正在获取歌曲信息」这个提示。
 */
const QUERY_TIMEOUT_MS = 8_000

/** 问了、也确实补到东西：这一版数据的有效期内不必再问 */
const FILLED_TTL_MS = 10 * 60_000
/** 问了但什么都没补到（服务端那边也没有）：隔久一点再问，避免每首歌都白问一遍 */
const EMPTY_TTL_MS = 30 * 60_000
/** 查询失败（超时 / 网络故障）：只是这一会儿不行，一分钟后就允许再试 */
const FAILED_TTL_MS = 60_000

/** 服务端那次补齐（读文件 + 探测）最多等它多久就撤掉加载提示，不让它一直挂着 */
const REFRESH_PATCHING_MAX_MS = 3 * 60_000
/**
 * 请服务端补齐的最小间隔。
 *
 * ★ 那个接口是**服务端全局任务**（一次把所有缺元数据的歌都过一遍），不是「补这一首」——
 *   从播放里自动触发它是有代价的，所以整进程内限流：十分钟最多请一次。用户想立刻再跑一遍
 *   有设置页那个按钮。
 */
const SERVER_REFRESH_INTERVAL_MS = 10 * 60_000

type Outcome = 'filled' | 'empty' | 'failed'

const TTL: Record<Outcome, number> = {
  filled: FILLED_TTL_MS,
  empty: EMPTY_TTL_MS,
  failed: FAILED_TTL_MS
}

/** 查询结果的缓存：键是「这首歌的这一版数据」（见 metadataCacheKey） */
const queryCache = new Map<string, { at: number; outcome: Outcome }>()
/** 同一版数据正在查（切歌来回切时不该并发查同一个） */
const inflight = new Set<string>()
/** 上一次请服务端补齐的时刻 */
let lastServerRefreshAt = 0
/** 撤掉加载提示的兜底定时器 */
let patchingTimer: number | null = null

interface SongMetadataState {
  /** 正在为某一首歌获取信息（客户端查询 / 服务端补齐期间都为真） */
  patching: boolean
  /** 正在获取的是哪一首（换歌之后旧的那一份不该再让界面显示「获取中」） */
  patchingSongId: number | null
}

export const useSongMetadata = create<SongMetadataState>(() => ({
  patching: false,
  patchingSongId: null
}))

function beginPatching(songId: number): void {
  if (patchingTimer !== null) window.clearTimeout(patchingTimer)
  useSongMetadata.setState({ patching: true, patchingSongId: songId })
  patchingTimer = window.setTimeout(() => endPatching(), REFRESH_PATCHING_MAX_MS)
}

function endPatching(): void {
  if (patchingTimer !== null) {
    window.clearTimeout(patchingTimer)
    patchingTimer = null
  }
  useSongMetadata.setState({ patching: false, patchingSongId: null })
}

/** 只换队列里那一个对象 —— 与 refreshCurrentSong 同一套做法（见 playerCore） */
function replaceInQueue(song: Song): void {
  usePlayer.setState((state) => ({
    queue: state.queue.map((item) => (item.id === song.id ? song : item))
  }))
}

/**
 * 请服务端去补齐元数据。
 *
 * 限流 + 失败静默：这是**尽力而为**的后台动作，失败不值得打扰用户（曲库照样能放，
 * 只是那几项元数据暂时还是空的）。成功发起之后靠 useLibrary 的守望收口 ——
 * 它会在任务结束时把曲库版本号 +1，队列里这一首随之重取（见 useLibrary.invalidate）。
 */
function requestServerRefresh(song: Song): boolean {
  if (song.type === 'radio') return false
  const now = Date.now()
  if (now - lastServerRefreshAt < SERVER_REFRESH_INTERVAL_MS) return false

  let client
  try {
    client = requireClient()
  } catch {
    return false
  }
  lastServerRefreshAt = now
  void startMetadataRefresh(client)
    .then(() => {
      // 已经在跑的话后端回 409，那也没关系：守望照样能等到它结束
      useLibrary.getState().watchTasks()
    })
    .catch(() => undefined)
  return true
}

/**
 * 确保这首歌的元数据尽量齐全。
 *
 * 幂等，随便调：没有缺口、缓存还没过期、或同一版数据正在查（切歌来回切会撞上）时都直接返回，
 * 一个请求都不会多发。缓存以「歌 + 那一版数据」为键（见 metadataCacheKey），所以
 * 服务端刷新过之后（updated_at 变了）会自然重新问一次，不必手动作废。
 */
export async function ensureSongMetadata(song: Song): Promise<void> {
  /*
   * 双击打开的本地文件不入曲库（id 为负，见 shared/local-file）：它的元数据只能从文件名来。
   * ★ 必须在这里让开 —— 否则下面那段兜底会去请服务端跑一次「全库刷新元数据」：那是个
   *   服务端全局任务（读一遍所有音频文件、动辄几分钟），为一首本机文件触发它，代价完全不成比例。
   */
  if (song.id <= 0) return

  // 没有缺口 = 一个请求都不发（「网络查询只针对缺失字段」的第一道闸）
  if (!findMetadataGaps(song).any) return

  const key = metadataCacheKey(song)
  const cached = queryCache.get(key)
  if (cached && Date.now() - cached.at < TTL[cached.outcome]) return
  if (inflight.has(key)) return

  let client
  try {
    client = requireClient()
  } catch {
    // 未登录 / 还没配好服务器：不起加载提示，也不用记账
    return
  }

  inflight.add(key)
  beginPatching(song.id)

  let patched = false
  let requestedServer = false
  try {
    const fresh = await getSong(client, song.id, { timeoutMs: QUERY_TIMEOUT_MS })
    const merged = mergeMetadata(song, fresh)
    patched = merged !== song
    if (patched) {
      replaceInQueue(merged)
      /*
       * 补齐可能让这首歌**第一次有了歌词**（补到了 lyric_url）：起播那一刻的 loadLyrics
       * 是按当时那份数据判的「有没有歌词来源」，它当时判的是没有。这里补上之后得再取一次，
       * 否则歌名歌手都出来了、歌词却一直空着，直到用户手动点「重试」。
       */
      const player = usePlayer.getState()
      const current = player.currentSong()
      if (
        current?.id === merged.id &&
        player.lyrics.lines.length === 0 &&
        filled(merged.lyric_url)
      ) {
        void player.reloadLyrics()
      }
    }
    queryCache.set(key, { at: Date.now(), outcome: patched ? 'filled' : 'empty' })
  } catch {
    // 超时 / 网络故障：记一笔短的账，界面继续用手上这份（降级）
    queryCache.set(key, { at: Date.now(), outcome: 'failed' })
  } finally {
    inflight.delete(key)
  }

  // 客户端问不出来 → 请服务端去补。请不动（限流 / 未登录）就把加载提示收掉，别让它空转
  if (!patched) requestedServer = requestServerRefresh(song)
  if (!requestedServer) endPatching()
}

/**
 * 装上「起播即补齐」的守望。App 启动时调一次（与 installMiniHost 那几条同一处）。
 *
 * ★ 判据是 `playing || buffering` 而不是「当前曲目变了」：`restoreLastQueue` 会在启动时
 *   恢复上次的队列但**不自动播放**，那时去补齐是白花一次请求（用户可能一整天都不碰它）。
 *   一个订阅就够 —— 它每次播放状态变化都会跑一遍，里面那两道判断（有缺口没有 / 缓存没过期）
 *   才是真正的闸门，它们比在这里记一堆「上次处理到哪儿」可靠得多。
 *
 * ★ 另加一条对 `useLibrary.revision` 的订阅：那是「服务端的后台任务跑完了」的信号。有它
 *   才能把「正在获取歌曲信息…」这个提示**及时**收掉 —— 只靠上面那条 3 分钟的兜底定时器的话，
 *   服务端几秒钟就补完了，提示还会一直挂在那里，比不提示更糟。
 */
export function installMetadataWatch(): () => void {
  let lastSongId = -1

  const disposePlayer = usePlayer.subscribe((state) => {
    const song = state.currentSong()
    if (!song || (!state.playing && !state.buffering)) return
    // 同一首不重复触发（timeupdate 每秒四次，全靠这一条把订阅的开销压到可忽略）
    if (song.id === lastSongId) return
    lastSongId = song.id
    void ensureSongMetadata(song)
  })

  const disposeLibrary = useLibrary.subscribe((state, previous) => {
    if (state.revision !== previous.revision) endPatching()
  })

  return () => {
    disposePlayer()
    disposeLibrary()
  }
}

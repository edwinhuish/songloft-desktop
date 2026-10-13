/**
 * 曲库数据的版本号 + 后台任务的守望。
 *
 * 为什么需要这么一个 store：桌面端各处拿到的都是服务端曲库数据的**副本** —— 歌单与收藏
 * 在 usePlaylists 里，曲库 / 搜索 / 歌单详情 / 文件夹 / 首页这些页面的列表则在各自的
 * hook 里（useAsync / useSongList / usePlaylistSongs）。而「扫描曲库」（含强制扫描）与
 * 「刷新元数据」改的正是这批数据，它们跑在服务端、客户端没有推送通道：不打一声招呼的话，
 * 各处的副本会一直停在任务开始前那一刻 —— 曾经的表现就是「服务端建了一千多个歌单，
 * 界面里一个都没有」，直到手动点刷新或重启应用。
 *
 * 于是立一个号：
 *   * 任务结束就把号 +1（invalidate）；
 *   * 页面级的列表**在 hook 内部**订阅这个号（见 hooks/ 里那三个）—— 不必指望每个页面
 *     都记得挂一次，漏一处就是一处陈旧；
 *   * 挂在 store 上的那几份副本（歌单 / 收藏）在 invalidate 里直接重载：它们没有
 *     「重新挂载」的机会，页面级的列表则有。
 *
 * 守望（watchTasks）：这两件事是**服务端的全局任务**，可能在本页开着时结束，也可能在
 * 用户离开设置页之后才结束（刷新元数据动辄几分钟）。所以这里自己跟：进应用先问一次，
 * 在跑就每隔几秒看一眼，一停就把号 +1 —— 不依赖任何页面是否挂在界面上。
 */

import { create } from 'zustand'

import type { MetadataRefreshProgress, ScanProgress } from '@shared/types'
import { getMetadataRefreshProgress, getScanProgress } from '@/api/endpoints'
import { requireClient } from '@/state/useAuth'
import { usePlayer } from '@/state/usePlayer'
import { usePlaylists } from '@/state/usePlaylists'

/** 扫描「还在跑」的状态集（取值同后端 ScanStatus）：停下之后才有必要刷新各处副本 */
const SCAN_RUNNING: ReadonlySet<string> = new Set([
  'scanning',
  'importing',
  'splitting_cue',
  'creating_playlists',
  'cancelling'
])

/**
 * 扫描是否还在跑。
 *
 * 导出给设置页的进度显示用：状态表只该有一份，那边原先自己写了一行同样的字面量数组 ——
 * 后端加一个中间态就会出现「进度条停了但守望还在等」这类错位。
 */
export function isScanRunning(status: ScanProgress['status'] | undefined): boolean {
  return status != null && SCAN_RUNNING.has(status)
}

/** 刷新元数据是否还在跑（后端只有 running / cancelling 两个运行态） */
export function isMetadataRefreshRunning(
  status: MetadataRefreshProgress['status'] | undefined
): boolean {
  return status === 'running' || status === 'cancelling'
}

interface LibraryState {
  /**
   * 曲库数据的版本号。**只增不减**，数值本身没有含义。
   *
   * 页面级的列表把它放进请求依赖里，一变就重取 —— 别去比较新旧值，只要变了就该重取。
   */
  revision: number
  /** 曲库数据被改写了（扫描结束、元数据刷新结束、批量删除…）：号 +1，并重载 store 级副本 */
  invalidate: () => void
  /** 开始守望后台任务。可重复调用，已在守望时什么都不做 */
  watchTasks: () => void
}

/** 守望的轮询间隔。比设置页那份（1.2s / 2s）慢：那边是喂进度条的，这边只等「结束」一件事 */
const WATCH_INTERVAL = 3000

let watchTimer: number | null = null
/**
 * 这一次守望里「见过任务在跑」。
 *
 * 只有见过才在收工时刷新：进应用时那次例行检查多半是空闲的，那时刷新等于白发一轮请求
 * （而且页面会平白闪一下）。
 */
let sawRunning = false

function stopWatch(): void {
  if (watchTimer === null) return
  window.clearInterval(watchTimer)
  watchTimer = null
}

/** 问一次两个后台任务的状态；在跑就记下，都停下就收工 */
async function tick(): Promise<void> {
  try {
    /*
     * requireClient() 是**抛**而不是返回 null，所以这里必须是一个 async 函数体里的 try：
     * 写成 fs.then(...).catch(...) 的话，它在求值参数时就同步抛了，catch 根本没机会接 ——
     * 而轮询跑在定时器里，那是未捕获异常。登出之后、或后端没起时都会走到这条路。
     */
    const client = requireClient()
    const [scan, meta] = await Promise.all([
      getScanProgress(client),
      getMetadataRefreshProgress(client)
    ])
    if (isScanRunning(scan.status) || isMetadataRefreshRunning(meta.status)) {
      sawRunning = true
      return
    }
    stopWatch()
    if (!sawRunning) return
    sawRunning = false
    useLibrary.getState().invalidate()
  } catch {
    // 连不上（未登录 / 后端没起）：这次不守望了，下一次 watchTasks 再试
    stopWatch()
  }
}

export const useLibrary = create<LibraryState>((set) => ({
  revision: 0,

  invalidate: () => {
    set((state) => ({ revision: state.revision + 1 }))

    // store 级的那几份副本自己重载。silent：这是后台同步，不该在侧栏闪一下「加载中」
    void usePlaylists.getState().load({ silent: true })
    void usePlaylists.getState().loadFavorites()

    /*
     * 队列里那一堆 Song 副本**不**跟着换：后端没有「按 id 批量取歌」的接口
     * （只有 /songs/ids 那种只回 id 的），几百条的队列要挨个请求，不划算。
     * 只把正在播放的那一首重取一次 —— 播放条与系统托盘上看得见的就是它。
     */
    void usePlayer.getState().refreshCurrentSong()
  },

  watchTasks: () => {
    if (watchTimer !== null) return
    watchTimer = window.setInterval(() => void tick(), WATCH_INTERVAL)
    // 立刻问一次：进应用时服务端可能就正在扫（上一次会话、或另一台客户端起的任务）
    void tick()
  }
}))

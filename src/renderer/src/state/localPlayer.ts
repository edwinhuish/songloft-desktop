/**
 * **真播放器**：一个模块级的 `HTMLAudioElement` + zustand 状态。
 *
 * ★ 这个进程（主窗口）是播放的唯一事实源：音频、队列、游标、歌词、音量全在这里。
 *   迷你窗那边拿到的是它的**镜像**（state/remotePlayer.ts），两份靠 IPC 对齐 ——
 *   两个窗口各放一份音频是不可能的（同一首歌会响两遍），所以只有这一份。
 *
 * 一个模块级的 `HTMLAudioElement` + zustand 状态，刻意不用 React 的 ref：
 * 切歌、切页面、抽屉开关都不该重建音频元素（重建 = 断流 + 丢失缓冲）。
 *
 * ★ 播放失败不是「立刻跳下一首」，而是先**换音源**重试：坏源里有一大半是加工环节的问题
 *   （降码率转码、老格式转码、ffmpeg 音量归一化），换个取法往往就能出声。逐级退让的候选链
 *   在 lib/url.ts 的 songUrlCandidates；试满 MAX_SOURCE_ATTEMPTS 次仍不行才跳到下一首。
 * ★ 元数据（封面 / 歌词 / 歌手 / 歌名）缺失的补齐**不在这个文件里**：它跟播放没有耦合
 *   （补齐到达时只换队列里那一个对象，不碰 audio），见 state/song-metadata.ts。
 *
 * 与 Flutter 端的对应关系：
 *   playMode           ↔ AppConstants.playModeLoop/Single/Random（那边的 playModeOrder —— 「顺序
 *                        播放，播完就停」—— 这里没有：本应用只有列表循环 / 单曲循环 / 随机三档，
 *                        老配置里存着 order 的话在 main/store.ts 那一层就被换成合法值了）
 *   order/cursor       ↔ 随机模式下的洗牌序列（原实现是 play_queue）
 *   reportedPlayed     ↔ POST /api/v1/songs/{id}/played
 *   mediaSession       ↔ audio_service / MPRIS（桌面端由 Chromium 直接接 MPRIS）
 */

import { create } from 'zustand'

import type { PlayMode, PlaybackContext, Song } from '@shared/types'
import { getLyric, getSong, reportPlayed } from '@/api/endpoints'
import { fetchCoverAccentFor } from '@/lib/accent'
import { parseLyrics, type ParsedLyric } from '@shared/lyric'
import { songCoverUrl } from '@shared/metadata'
import { buildCoverUrl, buildSongUrl, MAX_SOURCE_ATTEMPTS, songUrlCandidates } from '@/lib/url'
import { displayArtist } from '@/lib/format'
import { requireClient, resourceContext } from './useAuth'
import { useSettings } from './useSettings'
import { useToasts } from './useToasts'

const EMPTY_LYRIC: ParsedLyric = { lines: [], synced: false, meta: {}, offset: 0 }

export interface PlayerState {
  queue: Song[]
  /** 播放顺序：非随机模式下是 0..n-1，随机模式下是洗牌后的下标序列 */
  order: number[]
  /** order 内的游标；-1 表示还没开始播 */
  cursor: number
  playing: boolean
  buffering: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  playMode: PlayMode
  error: string | null
  lyrics: ParsedLyric
  lyricsLoading: boolean
  lyricFailed: boolean
  /** 音轨列表（>1 时界面显示原伴唱切换） */
  tracks: { index: number; title: string | null; language: string | null }[]
  activeTrack: number
  context: PlaybackContext | null

  currentSong: () => Song | null
  playSongs: (songs: Song[], startIndex?: number, context?: PlaybackContext | null) => Promise<void>
  playSong: (song: Song, context?: PlaybackContext | null) => Promise<void>
  toggle: () => Promise<void>
  pause: () => void
  next: (auto?: boolean) => Promise<void>
  previous: () => Promise<void>
  seek: (seconds: number) => void
  seekBy: (delta: number) => void
  setVolume: (volume: number) => void
  /** 立刻把当前音量写盘（拖动结束/窗口关闭前用），并取消尚未执行的合并写 */
  flushVolume: () => void
  toggleMute: () => void
  cyclePlayMode: () => void
  setPlayMode: (mode: PlayMode) => void
  addToQueue: (songs: Song[], position?: 'end' | 'next') => void
  removeFromQueue: (indexes: number[]) => void
  moveInQueue: (from: number, to: number) => void
  clearQueue: () => void
  jumpTo: (index: number) => Promise<void>
  setActiveTrack: (track: number) => Promise<void>
  restoreLastQueue: () => Promise<void>
  /** 重新拉一次当前歌曲的歌词（歌词加载失败时界面上的「重试」） */
  reloadLyrics: () => Promise<void>
  /** 重取「正在播放」那一首的元数据（曲库扫描 / 刷新元数据之后由 useLibrary 调） */
  refreshCurrentSong: () => Promise<void>
}

const audio = new Audio()
audio.preload = 'auto'

function identityOrder(length: number): number[] {
  return Array.from({ length }, (_, i) => i)
}

function shuffleIndices(length: number, keepFirst?: number): number[] {
  const indices = identityOrder(length)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  if (keepFirst != null) {
    const at = indices.indexOf(keepFirst)
    if (at > 0) {
      ;[indices[0], indices[at]] = [indices[at], indices[0]]
    }
  }
  return indices
}

/* ─────────────────────── 歌词缓存 ─────────────────────── */

const lyricCache = new Map<string, ParsedLyric>()

function lyricCacheKey(song: Song): string {
  return `${song.id}:${song.updated_at}`
}

async function loadLyrics(song: Song): Promise<{ parsed: ParsedLyric; failed: boolean }> {
  const key = lyricCacheKey(song)
  const cached = lyricCache.get(key)
  if (cached) return { parsed: cached, failed: false }

  const hasLyric = Boolean(song.lyric_url) || song.type === 'local'
  if (!hasLyric) return { parsed: EMPTY_LYRIC, failed: false }

  try {
    const payload = await getLyric(requireClient(), song.id)
    const parsed = parseLyrics({
      lyric: payload.lyric ?? '',
      tlyric: payload.tlyric ?? '',
      rlyric: payload.rlyric ?? '',
      lxlyric: payload.lxlyric ?? ''
    })
    if (parsed.lines.length > 0) lyricCache.set(key, parsed)
    return { parsed, failed: false }
  } catch {
    return { parsed: EMPTY_LYRIC, failed: true }
  }
}

/* ─────────────────────── 最近播放（本地）─────────────────────── */

function rememberRecent(songId: number): void {
  const { settings, patch } = useSettings.getState()
  const next = [songId, ...settings.recentSongIds.filter((id) => id !== songId)].slice(0, 200)
  void patch({ recentSongIds: next })
}

/* ─────────────────────── 系统媒体控件 ─────────────────────── */

function updateMediaSession(song: Song, playing: boolean): void {
  if (!('mediaSession' in navigator)) return
  const ctx = resourceContext()
  // 封面走后端出图，缺了就退到原始音源封面（见 shared/metadata 的 songCoverUrl）
  const cover = buildCoverUrl(songCoverUrl(song), ctx, 512)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: displayArtist(song.artist),
    album: song.album ?? '',
    artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : []
  })
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
}

function updatePositionState(): void {
  if (
    !('mediaSession' in navigator) ||
    typeof navigator.mediaSession.setPositionState !== 'function'
  )
    return
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: Math.min(audio.currentTime, audio.duration),
      playbackRate: audio.playbackRate
    })
  } catch {
    /* 某些状态下 Chromium 会拒绝，忽略即可 */
  }
}

/* ──────────────────── 音量落盘（合并写） ──────────────────── */

/**
 * 音量的变化形态是「持续连发」：拖音量条每个 pointermove 一次，按住 ↑/↓ 会随按键重复连发。
 * 而每次写盘要走 IPC + 主进程的 `writeFileSync` + `renameSync`（整份 JSON，同步 I/O），
 * 拖一次音量条就是几十次全量落盘，主进程会被拖住。这里把连续改动合并成
 * 「静默 400ms 后的一跳」；拖动结束时再显式 flush，保证最后一次值不会只留在内存里。
 */
const VOLUME_PERSIST_DEBOUNCE_MS = 400
let volumePersistTimer: ReturnType<typeof setTimeout> | null = null

function scheduleVolumePersist(volume: number, immediate = false): void {
  if (volumePersistTimer) {
    clearTimeout(volumePersistTimer)
    volumePersistTimer = null
  }
  if (immediate) {
    void useSettings.getState().patch({ volume })
    return
  }
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null
    void useSettings.getState().patch({ volume })
  }, VOLUME_PERSIST_DEBOUNCE_MS)
}

/* ─────────────────────── store ─────────────────────── */

/*
 * 换源的记账（模块级，不进 store）：
 *
 *   · `currentAttempt` —— 这一首已经试到第几个音源了（0 = 首选）。error 事件是**只注册一次**的，
 *     它要读的正是「此刻正在试第几个」；
 *   · `expectedSrc` —— 此刻期望在放哪一个地址。换源时旧地址的 error 可能迟到（浏览器对
 *     「换了 src 之后旧资源报错」没有约定），拿它做闸门，免得把旧地址的失败算到新地址头上
 *     ——那会表现为「刚换到备用音源就立刻又换」（连换两次、白白跳过一首）；
 *   · `requestedTrack` —— 用户点「伴奏」选中的那条音轨。换源重试要**停在这条轨上**，不能
 *     悄悄退回原唱；undefined = 交给后端决定默认轨（换一首歌就归位）。
 *   · `accountedSong` —— 这一次收听（首次尝试 + 它的所有重试）已经记过账了没有。换源重试
 *     会重跑一遍 startSong 的成功路径，不拦一下的话一次收听会往服务端报 2~3 次播放。
 */
let currentAttempt = 0
let expectedSrc = ''
let requestedTrack: number | undefined
let accountedSong = -1

export const localPlayer = create<PlayerState>((set, get) => {
  /**
   * 真正把某首歌灌进 audio 元素。
   *
   * `attempt` 是「同一首歌第几次试」（0 = 首选音源）。播放失败时由 error 处理逐级调上来
   * （见下面那段），到 MAX_SOURCE_ATTEMPTS 还没出声才跳到下一首。
   */
  async function startSong(song: Song, ctx: PlaybackContext | null, attempt = 0): Promise<void> {
    const settings = useSettings.getState().settings
    // 首次尝试 = 一次新的收听：上一首选的音轨、上一次的记账都在这时归位
    if (attempt === 0) {
      requestedTrack = undefined
      accountedSong = -1
    }
    const candidates = songUrlCandidates(song, resourceContext(), {
      quality: settings.quality,
      normalize: settings.volumeNormalize,
      track: requestedTrack
    })
    if (candidates.length === 0) {
      set({ error: '这首歌没有可播放的地址', buffering: false, playing: false })
      return
    }

    // 候选比尝试次数少时就停在最后一个上重试（同一个地址再拉一遍，扛瞬时抖动）
    const url = candidates[Math.min(attempt, candidates.length - 1)]
    currentAttempt = attempt

    set({
      error: null,
      buffering: true,
      context: ctx,
      /*
       * 歌词与音轨只在首次尝试时清空：换源重试时把它们清掉，界面会先白一下再重新填回来
       * （歌词有缓存、音轨要再探一次），而这两样与「用哪个音源拉同一份音频」无关。
       */
      ...(attempt === 0
        ? { lyrics: EMPTY_LYRIC, lyricsLoading: true, tracks: [], activeTrack: -1 }
        : {})
    })
    audio.src = url
    // 读回来的是 DOM 解析过的绝对地址 —— 与 error 事件里的 audio.src 才是同一口径
    expectedSrc = audio.src
    audio.volume = settings.volume

    try {
      await audio.play()
    } catch (error) {
      set({ buffering: false, playing: false })
      const message = error instanceof Error ? error.message : String(error)
      /*
       * NotAllowedError 只会在「没有用户手势」时出现，属于程序问题而非资源问题 ——
       * 这一条**不换源**（换个地址照样会被拦），也不该把它算进尝试次数里。
       */
      set({
        error: message.includes('NotAllowed')
          ? '浏览器阻止了自动播放，请点一下播放按钮'
          : `播放失败：${message}`
      })
      return
    }

    /*
     * 播放成功后才记账 —— 且一次收听只记一次：首次音源失败、第二个才出声时，成功的是
     * 第二次调用，账要记在这一次上；反过来，能出声之后又换源（不该发生，但真发生了也别重复报）。
     */
    if (accountedSong !== song.id) {
      accountedSong = song.id
      void reportPlayed(requireClient(), song.id, { type: 'play', context: ctx }).catch(
        () => undefined
      )
      rememberRecent(song.id)
    }

    // 封面主色 → 整页强调色
    if (settings.accentFromCover) {
      const coverAbsolute = buildCoverUrl(songCoverUrl(song), resourceContext(), 96)
      void fetchCoverAccentFor(coverAbsolute).then((hex) => {
        if (hex && get().currentSong()?.id === song.id) useSettings.getState().setCoverAccent(hex)
      })
    }

    void loadLyrics(song).then(({ parsed, failed }) => {
      if (get().currentSong()?.id !== song.id) return
      set({ lyrics: parsed, lyricsLoading: false, lyricFailed: failed })
    })

    // 原伴唱多音轨探测（失败静默：绝大多数歌都是单轨）
    void requireClient()
      .request<{ tracks: { index: number; title: string | null; language: string | null }[] }>(
        `/songs/${song.id}/audio-tracks`
      )
      .then((res) => {
        if (get().currentSong()?.id !== song.id) return
        const tracks = res.tracks ?? []
        /*
         * 「此刻在放哪一条轨」：用户点过切轨就以他选的为准（重试路径上尤其重要 ——
         * 否则界面会跳回原唱，而声音还在伴奏上）。没点过才取第一条可用轨。
         */
        const preferred =
          requestedTrack != null && tracks.some((t) => t.index === requestedTrack)
            ? requestedTrack
            : tracks.length > 1
              ? tracks[0].index
              : -1
        set({
          tracks: tracks.map((t) => ({ index: t.index, title: t.title, language: t.language })),
          activeTrack: preferred
        })
      })
      .catch(() => set({ tracks: [], activeTrack: -1 }))
  }

  /** 按 order 前进/后退，返回是否成功移动游标 */
  async function step(direction: 1 | -1, auto: boolean): Promise<void> {
    const { order, cursor, queue, playMode } = get()
    if (order.length === 0) return

    if (playMode === 'single' && auto) {
      audio.currentTime = 0
      await audio.play().catch(() => undefined)
      return
    }

    let nextCursor = cursor + direction
    /* 放完队尾接回队首：三档模式都接着放（曾经还有一档「顺序播放」是播完就停，那一档已去掉） */
    if (nextCursor >= order.length) nextCursor = 0
    if (nextCursor < 0) nextCursor = order.length - 1

    set({ cursor: nextCursor })
    const song = queue[order[nextCursor]]
    if (song) await startSong(song, get().context)
  }

  /* ── audio 事件接线（只接一次）── */
  audio.addEventListener('timeupdate', () => {
    set({ currentTime: audio.currentTime })
    updatePositionState()
  })
  audio.addEventListener('durationchange', () => {
    set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
  })
  audio.addEventListener('playing', () => set({ playing: true, buffering: false }))
  audio.addEventListener('pause', () => {
    set({ playing: false })
    // 通过暂停操作（而非自动播放）也要同步到托盘与系统媒体控件
    const song = get().currentSong()
    if (song) {
      updateMediaSession(song, false)
      void window.songloft.tray.update({
        title: song.title,
        artist: song.artist,
        playing: false,
        favorite: false
      })
    }
  })
  audio.addEventListener('waiting', () => set({ buffering: true }))
  audio.addEventListener('canplay', () => set({ buffering: false }))
  audio.addEventListener('ended', () => {
    void step(1, true)
  })
  audio.addEventListener('error', () => {
    // 换源时旧地址的失败会迟到：只认「此刻期望在放的那一个」（见 expectedSrc 的说明）
    if (expectedSrc && audio.src !== expectedSrc) return

    const song = get().currentSong()
    if (!song) return
    const code = audio.error?.code
    const detail =
      code === 4
        ? '无法解码或源不可用（后端可能需要转码，或直链已失效）'
        : code === 2
          ? '网络中断'
          : '资源加载失败'

    /*
     * ▸ 换源：同一首歌的失败多半出在「加工环节」而不是文件本身（降码率转码、老格式转码、
     *   EBU R128 音量归一化都要动 ffmpeg）。候选链逐级退掉这些环节（见 songUrlCandidates），
     *   所以这里不是「原样重试」而是「换一个取法再试」。
     * ▸ 连试 MAX_SOURCE_ATTEMPTS 个音源仍不出声 → 才认账并跳到下一首：坏源不该把队列卡死。
     */
    const nextAttempt = currentAttempt + 1
    if (nextAttempt < MAX_SOURCE_ATTEMPTS) {
      useToasts
        .getState()
        .push(`播放失败，换用备用音源重试（第 ${nextAttempt + 1} 次）`, 'info', detail)
      void startSong(song, get().context, nextAttempt)
      return
    }

    set({ buffering: false, playing: false, error: `${song.title}：${detail}` })
    useToasts.getState().push('播放失败，已跳到下一首', 'error', detail)
    // 尝试次数在切歌时由 startSong 归零，这里不必手动清
    if (get().order.length > 1) void step(1, true)
  })

  return {
    queue: [],
    order: [],
    cursor: -1,
    playing: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    volume: useSettings.getState().settings.volume,
    muted: false,
    playMode: useSettings.getState().settings.playMode,
    error: null,
    lyrics: EMPTY_LYRIC,
    lyricsLoading: false,
    lyricFailed: false,
    tracks: [],
    activeTrack: -1,
    context: null,

    currentSong: () => {
      const { queue, order, cursor } = get()
      if (cursor < 0 || cursor >= order.length) return null
      return queue[order[cursor]] ?? null
    },

    playSongs: async (songs, startIndex = 0, context = null) => {
      if (songs.length === 0) return
      const mode = get().playMode
      const order =
        mode === 'random' ? shuffleIndices(songs.length, startIndex) : identityOrder(songs.length)
      const cursor = mode === 'random' ? order.indexOf(startIndex) : startIndex
      set({ queue: songs, order, cursor: cursor >= 0 ? cursor : 0, context })
      await startSong(songs[startIndex], context)
    },

    playSong: async (song, context = null) => {
      await get().playSongs([song], 0, context)
    },

    toggle: async () => {
      if (get().cursor < 0) {
        // 队列空：让调用方决定放什么，这里只提示
        return
      }
      if (audio.paused) {
        await audio.play().catch((error: unknown) => {
          set({ error: error instanceof Error ? error.message : '播放失败' })
        })
      } else {
        audio.pause()
      }
    },

    pause: () => audio.pause(),

    next: async (auto = false) => step(1, auto),

    previous: async () => {
      // 播过 5 秒以上先回到开头，这是播放器的通用约定
      if (audio.currentTime > 5) {
        audio.currentTime = 0
        return
      }
      await step(-1, false)
    },

    seek: (seconds) => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration))
      set({ currentTime: audio.currentTime })
      updatePositionState()
    },

    seekBy: (delta) => get().seek(audio.currentTime + delta),

    reloadLyrics: async () => {
      const song = get().currentSong()
      if (!song) return
      // 「重试」的语义是「现在再去后端问一次」，所以要先丢掉这一首的缓存键 ——
      // 否则后端刚补齐歌词也拿不到（失败态下缓存里虽然没有，但重试前成功过一次的情况需要它）
      lyricCache.delete(lyricCacheKey(song))
      set({ lyricsLoading: true, lyricFailed: false })
      const { parsed, failed } = await loadLyrics(song)
      // 期间用户可能已经切歌，回来的结果不能再往界面上贴
      if (get().currentSong()?.id !== song.id) return
      set({ lyrics: parsed, lyricsLoading: false, lyricFailed: failed })
    },

    refreshCurrentSong: async () => {
      const song = get().currentSong()
      if (!song) return
      try {
        const fresh = await getSong(requireClient(), song.id)
        /*
         * 只换队列里那一个对象，别的一律不动：
         *   · 不碰 audio —— 变的是元数据（标题/封面/时长），正在播的那一轨不该被打断；
         *   · 不动 order / cursor —— 队列顺序与位置是用户的东西，跟元数据没关系。
         * 拉不到就维持原样（多半是这首歌刚被删掉）：播放器自己会走「播不了」那条路，
         * 这里不替它做决定。
         */
        set((state) => ({
          queue: state.queue.map((item) => (item.id === fresh.id ? fresh : item))
        }))
      } catch {
        // 静默：这是后台同步，失败不值得打断用户
      }
    },

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume))
      audio.volume = clamped
      audio.muted = false
      set({ volume: clamped, muted: false })
      scheduleVolumePersist(clamped)
    },

    flushVolume: () => scheduleVolumePersist(get().volume, true),

    toggleMute: () => {
      const muted = !get().muted
      audio.muted = muted
      set({ muted })
    },

    cyclePlayMode: () => {
      /* 三档一圈：列表循环 → 单曲循环 → 随机 → 回到列表循环（曾经第一档是「顺序播放」，已去掉） */
      const modes: PlayMode[] = ['loop', 'single', 'random']
      const current = get().playMode
      get().setPlayMode(modes[(modes.indexOf(current) + 1) % modes.length])
    },

    setPlayMode: (mode) => {
      const { queue, cursor, order } = get()
      const currentIndex = cursor >= 0 && cursor < order.length ? order[cursor] : -1
      let nextOrder = order
      if (mode === 'random' && order.length > 0) {
        nextOrder = shuffleIndices(queue.length, currentIndex >= 0 ? currentIndex : undefined)
      } else if (mode !== 'random') {
        nextOrder = identityOrder(queue.length)
      }
      const nextCursor = currentIndex >= 0 ? nextOrder.indexOf(currentIndex) : -1
      set({ playMode: mode, order: nextOrder, cursor: nextCursor })
      void useSettings.getState().patch({ playMode: mode })
    },

    addToQueue: (songs, position = 'end') => {
      const { queue, order, cursor } = get()
      if (position === 'next') {
        const insertAt = cursor + 1
        const nextQueue = [...queue]
        nextQueue.splice(insertAt, 0, ...songs)
        const nextOrder = [
          ...order.slice(0, insertAt),
          ...songs.map((_, i) => queue.length + i),
          ...order.slice(insertAt)
        ]
        set({ queue: nextQueue, order: nextOrder })
      } else {
        set({
          queue: [...queue, ...songs],
          order: [...order, ...songs.map((_, i) => queue.length + i)]
        })
      }
    },

    removeFromQueue: (indexes) => {
      const remove = new Set(indexes)
      const { queue, order, cursor } = get()
      const currentIndex = cursor >= 0 && cursor < order.length ? order[cursor] : -1
      const nextQueue = queue.filter((_, i) => !remove.has(i))
      const remap = new Map<number, number>()
      let write = 0
      queue.forEach((_, i) => {
        if (!remove.has(i)) remap.set(i, write++)
      })
      const nextOrder = order.filter((i) => !remove.has(i)).map((i) => remap.get(i) ?? 0)
      const nextCursor =
        currentIndex >= 0 && remap.has(currentIndex)
          ? nextOrder.indexOf(remap.get(currentIndex)!)
          : -1
      set({ queue: nextQueue, order: nextOrder, cursor: nextCursor })
    },

    moveInQueue: (from, to) => {
      const { queue, order } = get()
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return
      const currentIndex = get().cursor >= 0 ? order[get().cursor] : -1
      const nextQueue = [...queue]
      const [moved] = nextQueue.splice(from, 1)
      nextQueue.splice(to, 0, moved)
      // 队列重排后顺序全部按新顺序走（随机模式的洗牌序列作废，符合直觉）
      const nextOrder = identityOrder(nextQueue.length)
      const nextCursor =
        currentIndex >= 0 ? (from === currentIndex ? to : nextOrder.indexOf(currentIndex)) : -1
      set({ queue: nextQueue, order: nextOrder, cursor: nextCursor })
    },

    clearQueue: () => {
      audio.pause()
      audio.removeAttribute('src')
      // 队列清空后没有「期望地址」了：留着旧值会让下一首的 error 被误判成迟到的旧错误
      expectedSrc = ''
      currentAttempt = 0
      requestedTrack = undefined
      accountedSong = -1
      set({
        queue: [],
        order: [],
        cursor: -1,
        playing: false,
        currentTime: 0,
        duration: 0,
        lyrics: EMPTY_LYRIC,
        error: null
      })
    },

    jumpTo: async (index) => {
      const { queue, order, context } = get()
      const cursor = order.indexOf(index)
      if (cursor < 0) return
      set({ cursor })
      const song = queue[index]
      if (song) await startSong(song, context)
    },

    setActiveTrack: async (track) => {
      const song = get().currentSong()
      if (!song) return
      set({ activeTrack: track })
      // 记下这份意图：这一轨若加载失败，换源重试要停在同一条轨上（见 requestedTrack）
      requestedTrack = track
      const settings = useSettings.getState().settings
      const url = buildSongUrl(song, resourceContext(), {
        quality: settings.quality,
        normalize: settings.volumeNormalize,
        track
      })
      const wasPlaying = !audio.paused
      audio.src = url
      // 换了 src 就要把「期望地址」一起换掉，否则这一轨自己失败时会被 error 处理当成旧地址的迟到错误
      expectedSrc = audio.src
      // 切轨是一次新的尝试：计数归零，让这一轨也享有一整条候选链
      currentAttempt = 0
      if (wasPlaying) await audio.play().catch(() => undefined)
    },

    restoreLastQueue: async () => {
      const { settings } = useSettings.getState()
      if (settings.lastQueue.length === 0) return
      try {
        const client = requireClient()
        const songs = await Promise.all(
          settings.lastQueue.map((id) => client.request<Song>(`/songs/${id}`).catch(() => null))
        )
        const valid = songs.filter((s): s is Song => s !== null)
        if (valid.length === 0) return
        const order = identityOrder(valid.length)
        const cursor = Math.min(Math.max(0, settings.lastQueueIndex), valid.length - 1)
        set({
          queue: valid,
          order,
          cursor,
          // ★ 上下文也要一并还原：它标着「这个队列是从哪儿播起来的」，
          //   Panel 的「来自歌单/歌手」徽标、以及后续 /songs/{id}/played 的上报都读它。
          //   只恢复 lastQueue/lastQueueIndex 而丢掉这一项，等于每次重启都忘了来源。
          context: settings.lastQueueContext,
          // 不自动播放：恢复会话时突然出声是很糟的体验
          playing: false,
          currentTime: 0,
          duration: 0
        })
        const song = valid[cursor]
        if (song) {
          const url = buildSongUrl(song, resourceContext(), {
            quality: settings.quality,
            normalize: settings.volumeNormalize
          })
          audio.src = url
          // 与 startSong 同一套记账：这里也是「准备好一首但不播」，之后 play() 失败时要能按链换源
          expectedSrc = audio.src
          currentAttempt = 0
          audio.volume = settings.volume
          updateMediaSession(song, false)
          void loadLyrics(song).then(({ parsed, failed }) =>
            set({ lyrics: parsed, lyricFailed: failed })
          )
        }
      } catch {
        /* 队列恢复失败不该拦住启动 */
      }
    }
  }
})

/* ─────────────────────── 持久化播放进度 ─────────────────────── */

let persistTimer: number | null = null

localPlayer.subscribe(() => {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    const { queue, order, cursor, context } = localPlayer.getState()
    void useSettings.getState().patch({
      lastQueue: queue.map((s) => s.id).slice(0, 500),
      lastQueueIndex: cursor >= 0 && cursor < order.length ? order[cursor] : -1,
      lastQueueContext: context
    })
  }, 1500)
})

/* ─────────────────────── 系统媒体控件接线 ─────────────────────── */

export function installMediaSessionHandlers(): () => void {
  if (!('mediaSession' in navigator)) return () => undefined
  const session = navigator.mediaSession
  const player = localPlayer.getState()

  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void player.toggle()],
    ['pause', () => player.pause()],
    ['previoustrack', () => void player.previous()],
    ['nexttrack', () => void player.next(false)],
    ['seekbackward', (details) => player.seekBy(-(details.seekOffset ?? 10))],
    ['seekforward', (details) => player.seekBy(details.seekOffset ?? 10)],
    [
      'seekto',
      (details) => {
        if (details.seekTime != null) player.seek(details.seekTime)
      }
    ],
    ['stop', () => player.pause()]
  ]

  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler)
    } catch {
      /* 个别动作在该平台上不支持，跳过 */
    }
  }

  return () => {
    for (const [action] of handlers) {
      try {
        session.setActionHandler(action, null)
      } catch {
        /* 同上 */
      }
    }
  }
}

/** 当前歌曲 / 播放状态变化时刷新系统媒体控件与托盘 */
export function installNowPlayingSync(): () => void {
  let lastKey = ''
  return localPlayer.subscribe((state) => {
    const song =
      state.cursor >= 0 && state.cursor < state.order.length
        ? state.queue[state.order[state.cursor]]
        : null
    if (!song) return
    const key = `${song.id}:${state.playing}`
    if (key === lastKey) return
    lastKey = key
    updateMediaSession(song, state.playing)
    void window.songloft.tray.update({
      title: song.title,
      artist: song.artist,
      playing: state.playing,
      favorite: false
    })
  })
}

/** 供 App 启动时调用一次：把音量/播放模式同步给 audio 元素 */
export function primeAudio(): void {
  const settings = useSettings.getState().settings
  audio.volume = settings.volume
  localPlayer.setState({ volume: settings.volume, playMode: settings.playMode })
}

export { audio as audioElement }

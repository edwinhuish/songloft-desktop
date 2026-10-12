/**
 * 播放器。
 *
 * 一个模块级的 `HTMLAudioElement` + zustand 状态，刻意不用 React 的 ref：
 * 切歌、切页面、抽屉开关都不该重建音频元素（重建 = 断流 + 丢失缓冲）。
 *
 * 与 Flutter 端的对应关系：
 *   playMode           ↔ AppConstants.playModeOrder/Loop/Single/Random
 *   order/cursor       ↔ 随机模式下的洗牌序列（原实现是 play_queue）
 *   reportedPlayed     ↔ POST /api/v1/songs/{id}/played
 *   mediaSession       ↔ audio_service / MPRIS（桌面端由 Chromium 直接接 MPRIS）
 */

import { create } from 'zustand'

import type { PlayMode, PlaybackContext, Song } from '@shared/types'
import { getLyric, reportPlayed } from '@/api/endpoints'
import { fetchCoverAccentFor } from '@/lib/accent'
import { parseLyrics, type ParsedLyric } from '@shared/lyric'
import { buildCoverUrl, buildSongUrl } from '@/lib/url'
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
  /** 播放队列是否正在被拖动重排（避免高频写盘） */
  speed: number

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
  const cover = buildCoverUrl(song.cover_url, ctx, 512)
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

/* ─────────────────────── store ─────────────────────── */

export const usePlayer = create<PlayerState>((set, get) => {
  /** 真正把某首歌灌进 audio 元素 */
  async function startSong(song: Song, ctx: PlaybackContext | null): Promise<void> {
    const settings = useSettings.getState().settings
    const url = buildSongUrl(song, resourceContext(), {
      quality: settings.quality,
      normalize: settings.volumeNormalize,
      track: song.is_video ? undefined : undefined
    })
    if (!url) {
      set({ error: '这首歌没有可播放的地址' })
      return
    }

    set({
      error: null,
      buffering: true,
      lyrics: EMPTY_LYRIC,
      lyricsLoading: true,
      context: ctx,
      tracks: [],
      activeTrack: -1
    })
    audio.src = url
    audio.volume = settings.volume

    try {
      await audio.play()
    } catch (error) {
      set({ buffering: false, playing: false })
      const message = error instanceof Error ? error.message : String(error)
      // NotAllowedError 只会在「没有用户手势」时出现，属于程序问题而非资源问题
      set({
        error: message.includes('NotAllowed')
          ? '浏览器阻止了自动播放，请点一下播放按钮'
          : `播放失败：${message}`
      })
      return
    }

    // 播放成功后才记账：失败的重试不该刷进「最近播放」
    void reportPlayed(requireClient(), song.id, { type: 'play', context: ctx }).catch(
      () => undefined
    )
    rememberRecent(song.id)

    // 封面主色 → 整页强调色
    if (settings.accentFromCover) {
      const coverAbsolute = buildCoverUrl(song.cover_url, resourceContext(), 96)
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
        set({
          tracks: tracks.map((t) => ({ index: t.index, title: t.title, language: t.language })),
          activeTrack: tracks.length > 1 ? tracks[0].index : -1
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
    if (nextCursor >= order.length) {
      if (playMode === 'order' && auto) {
        set({ playing: false })
        audio.pause()
        void window.songloft.tray.update({
          title: get().currentSong()?.title ?? null,
          artist: get().currentSong()?.artist ?? null,
          playing: false,
          favorite: false
        })
        return
      }
      nextCursor = 0
    }
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
    const song = get().currentSong()
    const code = audio.error?.code
    const detail =
      code === 4
        ? '无法解码或源不可用（后端可能需要转码，或直链已失效）'
        : code === 2
          ? '网络中断'
          : '资源加载失败'
    set({ buffering: false, playing: false, error: `${song?.title ?? '当前歌曲'}：${detail}` })
    useToasts.getState().push('播放失败，已跳到下一首', 'error', detail)
    // 自动跳过坏源，别把队列卡死
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
    speed: 1,

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

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume))
      audio.volume = clamped
      audio.muted = false
      set({ volume: clamped, muted: false })
      void useSettings.getState().patch({ volume: clamped })
    },

    toggleMute: () => {
      const muted = !get().muted
      audio.muted = muted
      set({ muted })
    },

    cyclePlayMode: () => {
      const modes: PlayMode[] = ['order', 'loop', 'single', 'random']
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
      const settings = useSettings.getState().settings
      const url = buildSongUrl(song, resourceContext(), {
        quality: settings.quality,
        normalize: settings.volumeNormalize,
        track
      })
      const wasPlaying = !audio.paused
      audio.src = url
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

usePlayer.subscribe(() => {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    const { queue, order, cursor, context } = usePlayer.getState()
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
  const player = usePlayer.getState()

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
  return usePlayer.subscribe((state) => {
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
  usePlayer.setState({ volume: settings.volume, playMode: settings.playMode })
}

export { audio as audioElement }

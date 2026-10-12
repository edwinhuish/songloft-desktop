/**
 * 应用外壳。
 *
 * 三层结构（栅格来自 base.css 的 .shell / .shell-body / .main-column）：
 *   ┌ 标题栏（自绘窗口控制 + 当前曲目 + 全局搜索入口）
 *   ├ 侧栏 │ 工具条 + 主滚动区 │ 右侧抽屉
 *   └ 播放条
 *
 * 三件「只该发生一次」的接线也放在这里：
 *   1. 全局快捷键（空格/方向键/Ctrl+K…）
 *   2. 主进程推送（托盘与媒体键发来的命令、菜单发来的导航）
 *   3. 启动编排（读设置 → 校验会话 → 预载歌单/收藏/上次队列）
 * 用模块级的 started 标志兜住，避免 HMR 或多次挂载把它们接两遍。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { MediaCommand } from '@shared/ipc'
import { AddToPlaylistDialog } from './components/AddToPlaylistDialog'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost } from './components/ContextMenu'
import { IconClose, IconLoader, IconSearch } from './components/Icons'
import { Panel } from './components/Panel'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { TooltipHost } from './components/Tooltip'
import { useResponsiveSidebar } from './hooks/useResponsiveSidebar'
import { FavoritesPage } from './pages/FavoritesPage'
import { FoldersPage } from './pages/FoldersPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { LoginPage } from './pages/LoginPage'
import { PlaylistDetailPage } from './pages/PlaylistDetailPage'
import { PlaylistsPage } from './pages/PlaylistsPage'
import { RecentPage } from './pages/RecentPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  installMediaSessionHandlers,
  installNowPlayingSync,
  primeAudio,
  usePlayer
} from './state/usePlayer'
import { useAuth } from './state/useAuth'
import { usePlaylists } from './state/usePlaylists'
import { useSettings, watchSystemTheme } from './state/useSettings'
import { routeFromPath, useUi, type Route } from './state/useUi'

let bootstrapped = false

/** 只在输入类元素之外响应空格这类「会打字的键」 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function App(): React.JSX.Element {
  const status = useAuth((s) => s.status)
  const started = useRef(false)

  /* ── 启动编排（一次）───────────────────────────────────────────── */
  useEffect(() => {
    if (started.current) return
    started.current = true

    const disposers: (() => void)[] = []

    void (async () => {
      // 先读设置：主题/强调色要在第一帧就正确，否则会闪一下默认配色
      await useSettings.getState().load()
      // ★ 侧栏折叠状态的「写」在 Sidebar 里（切一次就 patch 进设置），但界面初值是
      //   useUi 自己的 state、硬编码 false。不在这里回填的话，那个设置等于写了个寂寞：
      //   用户收起侧栏 → 重启 → 又展开了。
      useUi.getState().setSidebarCollapsed(useSettings.getState().settings.sidebarCollapsed)
      watchSystemTheme()
      primeAudio()

      if (!bootstrapped) {
        bootstrapped = true
        disposers.push(installMediaSessionHandlers())
        disposers.push(installNowPlayingSync())
      }

      await useAuth.getState().bootstrap()
      if (useAuth.getState().status === 'authenticated') {
        void usePlaylists.getState().load()
        void usePlaylists.getState().loadFavorites()
        void usePlayer.getState().restoreLastQueue()
      }
    })()

    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [])

  /* ── 主进程推送 ─────────────────────────────────────────────────── */
  useEffect(() => {
    const offMedia = window.songloft.on.mediaCommand((command) => handleMediaCommand(command))
    const offNavigate = window.songloft.on.navigate((path) => {
      const route = routeFromPath(path)
      if (route) useUi.getState().navigate(route)
    })
    return () => {
      offMedia()
      offNavigate()
    }
  }, [])

  /* ── 全局快捷键 ─────────────────────────────────────────────────── */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      const ui = useUi.getState()
      const player = usePlayer.getState()

      // 命令面板优先，且在任何输入状态下都能唤起
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }

      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.toolbar .search-field input')?.focus()
        return
      }

      if (mod && event.key === 'ArrowRight') {
        event.preventDefault()
        void player.next(false)
        return
      }
      if (mod && event.key === 'ArrowLeft') {
        event.preventDefault()
        void player.previous()
        return
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        ui.back()
        return
      }
      if (mod && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        ui.togglePanel('now-playing')
        return
      }

      if (isTypingTarget(event.target)) return

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        void player.toggle()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        player.setVolume(Math.min(1, player.volume + 0.05))
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        player.setVolume(Math.max(0, player.volume - 0.05))
        return
      }
      if (event.key === 'f' && !mod && !event.altKey) {
        // 单键 f 只在有当前歌曲时生效，避免误触
        const song = player.currentSong()
        if (song) void usePlaylists.getState().toggleFavorite(song)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ── 认证后预载数据 ─────────────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'authenticated') return
    void usePlaylists.getState().load()
    void usePlaylists.getState().loadFavorites()
    void usePlayer.getState().restoreLastQueue()
  }, [status])

  /* 未登录 / 启动中：同样是 frameless 窗口，必须带上标题栏才有拖拽区与窗口控制。
     少了它，登录页会变成一个既拖不动也关不掉的窗口（只能 Alt+F4）。 */
  if (status !== 'authenticated') {
    return (
      <div className="shell">
        <TitleBar solo />
        <div className="shell-solo">
          {status === 'booting' ? (
            <div className="solo-splash">
              <IconLoader size={26} />
              <div>正在恢复上次的会话…</div>
            </div>
          ) : (
            <LoginPage />
          )}
        </div>
      </div>
    )
  }

  return <Shell />
}

/* ─────────────────────────── 已登录后的外壳 ─────────────────────────── */

function Shell(): React.JSX.Element {
  // 窄窗口自动收成图标条。只动界面状态，不覆盖用户保存的偏好。
  useResponsiveSidebar()

  const route = useUi((s) => s.route)
  const panelOpen = useUi((s) => s.panelOpen)
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed)

  const content = useMemo(() => renderRoute(route), [route])

  return (
    <div className="shell">
      <TitleBar />

      <div
        className="shell-body"
        data-panel={panelOpen ? 'open' : 'closed'}
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        <Sidebar />

        <div className="main-column">
          <Toolbar />
          {/* key 只跟路由走。页签切换只影响右边抽屉，把 panelTab 也算进来的话，
              切一次页签主内容区就整体卸载重建一次 —— 列表和封面全被冲掉，
              看上去就是「左边闪一下」 */}
          <div className="main-scroll" key={route.name}>
            {content}
          </div>
        </div>

        <Panel />
      </div>

      <PlayerBar />

      <CommandPalette />
      <AddToPlaylistDialog />
      <ContextMenuHost />
      <TooltipHost />
      <Toasts />
    </div>
  )
}

function Toolbar(): React.JSX.Element {
  const route = useUi((s) => s.route)
  const navigate = useUi((s) => s.navigate)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const [draft, setDraft] = useState('')

  // 已进入搜索页时，输入框直接跟着路由走（改词即时生效，不用再回车一次）
  const isSearch = route.name === 'search'
  const value = isSearch ? route.keyword : draft

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const keyword = draft.trim()
    if (keyword) navigate({ name: 'search', keyword })
  }

  return (
    <div className="toolbar">
      <form className="search-field" onSubmit={submit}>
        <IconSearch size={16} />
        <input
          value={value}
          placeholder="搜索歌曲、歌手、专辑（Ctrl+K 打开命令面板）"
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            if (isSearch && next.trim()) navigate({ name: 'search', keyword: next })
          }}
        />
        {value ? (
          <button
            type="button"
            className="search-clear"
            aria-label="清空搜索"
            onClick={() => {
              setDraft('')
              if (isSearch) navigate({ name: 'library' })
            }}
          >
            <IconClose size={13} />
          </button>
        ) : null}
      </form>

      <div className="grow" />

      <button type="button" className="btn" data-size="sm" onClick={() => setPaletteOpen(true)}>
        命令面板
        <span className="badge">Ctrl K</span>
      </button>
    </div>
  )
}

function renderRoute(route: Route): React.JSX.Element {
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'library':
      return <LibraryPage />
    case 'favorites':
      return <FavoritesPage />
    case 'recent':
      return <RecentPage />
    case 'search':
      return <SearchPage keyword={route.keyword} />
    case 'playlists':
      return <PlaylistsPage />
    case 'playlist':
      return <PlaylistDetailPage playlistId={route.id} />
    case 'folders':
      return <FoldersPage path={route.path} />
    case 'settings':
      return <SettingsPage section={route.section} />
    default:
      return <HomePage />
  }
}

/** 托盘 / 媒体键发来的命令 */
function handleMediaCommand(command: MediaCommand): void {
  const player = usePlayer.getState()
  const ui = useUi.getState()

  switch (command.kind) {
    case 'play-pause':
      void player.toggle()
      break
    case 'next':
      void player.next(false)
      break
    case 'previous':
      void player.previous()
      break
    case 'seek':
      player.seekBy(command.delta)
      break
    case 'volume':
      player.setVolume(Math.max(0, Math.min(1, player.volume + command.delta)))
      break
    case 'toggle-mute':
      player.toggleMute()
      break
    case 'toggle-favorite': {
      const song = player.currentSong()
      if (song) void usePlaylists.getState().toggleFavorite(song)
      break
    }
    case 'toggle-lyrics':
      ui.togglePanel('now-playing')
      break
  }
}

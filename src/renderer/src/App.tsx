/**
 * 应用外壳。
 *
 * 三层结构（栅格来自 base.css 的 .shell / .shell-body / .main-column）：
 *   ┌ 标题栏（LOGO + 扩展入口 + 折叠菜单/搜索/窗口控制）—— 唯一常驻的原生 chrome
 *   ├ 侧栏 │ 工具条 + 主滚动区 │ 右侧抽屉
 *   └ 播放条
 *
 * ★ 标题栏以下是**一个可替换的内容面**：原生页（上面那三层）或者扩展主框架（左右分栏，
 *   左是扩展侧栏、右是插件商店/插件管理/某个扩展）。切换靠 `.shell[data-surface]`，
 *   见下面 Shell 里的分支 —— 扩展不是一个页签，而是一整块去处。
 *
 * 三件「只该发生一次」的接线也放在这里：
 *   1. 全局快捷键（空格/方向键/Ctrl+K…）
 *   2. 主进程推送（托盘与媒体键发来的命令、菜单发来的导航）
 *   3. 启动编排（读设置 → 校验会话 → 预载歌单/收藏/上次队列）
 * 用模块级的 started 标志兜住，避免 HMR 或多次挂载把它们接两遍。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { MediaCommand } from '@shared/ipc'
import { isNewerVersion } from '@shared/version'
import { checkServerUpgrade, getGithubProxy } from './api/endpoints'
import { AddToPlaylistDialog } from './components/AddToPlaylistDialog'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost } from './components/ContextMenu'
import { ExtensionFrame } from './components/ExtensionFrame'
import { IconClose, IconLoader, IconSearch } from './components/Icons'
import { Panel } from './components/Panel'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { TooltipHost } from './components/Tooltip'
import { useResponsiveSidebar } from './hooks/useResponsiveSidebar'
import { formatVersion } from './lib/format'
import { FavoritesPage } from './pages/FavoritesPage'
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
import { requireClient, useAuth } from './state/useAuth'
import { usePlaylists } from './state/usePlaylists'
import { usePlugins } from './state/usePlugins'
import { useSettings, watchSystemTheme } from './state/useSettings'
import { toast } from './state/useToasts'
import { routeFromPath, useUi, type Route } from './state/useUi'

let bootstrapped = false

/**
 * 启动时悄悄查一次更新：**服务端与客户端各查一次**（「关于与更新」里那个开关控制它）。
 *
 * 为什么只查一次、只在启动时查：一个版本能用很久，更密的轮询除了给 GitHub 刷请求
 * （它还有频率限制）没有别的作用；真想主动看，设置里那两个「检查更新」会明说。
 *
 * **全程静默**：没有新版本不说话、连不上也不说话 —— 启动时的后台动作不该冒泡成人要处理的
 * 东西。真有状况，去设置里点一次就知道原因。
 *
 * 两件事各自独立（`Promise.all` + 各自 catch）：客户端那次是主进程直连 GitHub，服务端那次
 * 是问后端 —— 它们的失败原因完全不同，让一边拖垮另一边没有道理。
 */
async function checkUpdatesInBackground(): Promise<void> {
  if (!useSettings.getState().settings.autoCheckUpdate) return
  const client = requireClient()

  // 代理拿不到（后端不可达）就直连；服务端那次也一样把代理传过去 —— 后端不会自己去读那项配置
  const proxy = await getGithubProxy(client).catch(() => '')
  const [release, upgrade, info] = await Promise.all([
    window.songloft.app.checkClientUpdate(proxy).catch(() => null),
    checkServerUpgrade(client, proxy).catch(() => null),
    window.songloft.app.info().catch(() => null)
  ])

  if (release && info && isNewerVersion(release.latestTag, info.version)) {
    toast(
      '客户端有新版本',
      'info',
      `${formatVersion(release.latestTag)} 已发布，可在「设置 → 关于与更新」查看`
    )
  }
  if (upgrade?.has_update && upgrade.latest_version) {
    toast(
      '服务端有新版本',
      'info',
      upgrade.is_docker
        ? `${formatVersion(upgrade.latest_version)}，可在「设置 → 关于与更新」升级`
        : `${formatVersion(upgrade.latest_version)}（服务端不是容器部署，需在服务器上替换二进制）`
    )
  }
}

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
        // 查不到、没新版本都不出声（见函数注释）
        void checkUpdatesInBackground().catch(() => undefined)
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
    if (status !== 'authenticated') {
      // 退出登录 / 切服务器都要清干净：留着的话标题栏会继续挂着**上一台服务器**的扩展
      usePlugins.getState().reset()
      return
    }
    void usePlaylists.getState().load()
    void usePlaylists.getState().loadFavorites()
    void usePlayer.getState().restoreLastQueue()
    // 拿不到扩展不该弹错：标题栏少几个按钮，总好过开机弹一条红字
    void usePlugins
      .getState()
      .load()
      .catch(() => undefined)
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

  // 扩展的三条路由（插件商店 / 插件管理 / 某个扩展）都走同一个框架，所以只看「在不在扩展里」。
  // 它要占满标题栏以下整块：左侧是扩展自己的侧栏，右侧那一栏再被主侧栏与播放条挤掉一大截就
  // 什么都不剩了。
  const inExtensions = route.name === 'extensions' || route.name === 'plugin'
  const surface = inExtensions ? 'extensions' : 'native'
  const content = useMemo(() => (surfacedInShell(route) ? renderRoute(route) : null), [route])

  return (
    <div className="shell" data-surface={surface}>
      <TitleBar />

      {/*
        标题栏以下是**一个可替换的内容面**，两种形态：
          * extensions —— 扩展主框架（左扩展侧栏 + 右内容面）；
          * native     —— 侧栏 + 工具条 + 主区 + 抽屉 + 播放条。
        前者整体不挂载原生那一套（而不是藏起来）：它要拿到完整的窗口高度，留着侧栏/
        播放条的 DOM 只是白占布局。宿主播放不会因此中断 —— 音频是模块级对象、不挂在
        DOM 上（见 state/usePlayer 的 audio）；扩展自己的 webview 则在框架内常驻。
      */}
      {inExtensions ? (
        <ExtensionFrame />
      ) : (
        <>
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
        </>
      )}

      <CommandPalette />
      <AddToPlaylistDialog />
      <ContextMenuHost />
      <TooltipHost />
      <Toasts />
    </div>
  )
}

/** 这个路由是不是走常规外壳（侧栏/工具条/播放条那一套）的那一档 */
function surfacedInShell(route: Route): boolean {
  return route.name !== 'plugin' && route.name !== 'extensions'
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
    // 「曲库」与「文件夹」是同一页的两种模式（标签条在页内），所以两条路由都落到它
    case 'library':
    case 'folders':
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
    case 'settings':
      return <SettingsPage section={route.section} />
    // 'plugin' 与 'extensions' 刻意没有分支：它们不走主内容区，而是把标题栏以下整块
    // 换成自己的内容面（见上面 Shell 里的 data-surface 分支与 surfacedInShell）
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

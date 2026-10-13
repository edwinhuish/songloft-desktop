/**
 * 应用外壳。
 *
 * 三层结构（栅格来自 base.css 的 .shell / .shell-body / .main-column）：
 *   ┌ 标题栏（LOGO + 扩展入口 + 折叠菜单/搜索/窗口控制）—— 唯一常驻的原生 chrome
 *   ├ 侧栏 │ 工具条 + 主滚动区 │ 右侧抽屉
 *   └ 播放条
 *
 * ★ 标题栏以下是**一个可替换的内容面**，两种形态：原生页（上面那三层）或者扩展主框架
 *   （左右分栏，左是扩展侧栏、右是插件商店/插件管理/某个扩展）。扩展不是一个页签，
 *   而是一整块去处 —— 所以它不是主内容区里的一页。
 *
 *   两面**都挂着，只藏不走**（`.surface[data-hidden]`）：切过去再切回来，每一面都还是
 *   离开时的样子（滚动位置、已加载的列表、商店筛到第几页、正在出声的扩展）。
 *   各面停在哪儿由 `useUi` 的两份路由分别记着，见那里的说明。
 *
 * 三件「只该发生一次」的接线也放在这里：
 *   1. 全局快捷键（空格/方向键/Ctrl+K…）
 *   2. 主进程推送（托盘与媒体键发来的命令、菜单发来的导航）
 *   3. 启动编排（读设置 → 校验会话 → 预载歌单/收藏/上次队列）
 * 用模块级的 started 标志兜住，避免 HMR 或多次挂载把它们接两遍。
 */

import { useEffect, useRef, useState } from 'react'

import type { MediaCommand } from '@shared/ipc'
import { isNewerVersion } from '@shared/version'
import { checkServerUpgrade, getGithubProxy } from './api/endpoints'
import { AddToPlaylistDialog } from './components/AddToPlaylistDialog'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost } from './components/ContextMenu'
import { ExtensionFrame } from './components/ExtensionFrame'
import { FullPlayer } from './components/FullPlayer'
import { IconClose, IconLoader, IconSearch } from './components/Icons'
import { MiniPlayer } from './components/MiniPlayer'
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
import { useLibrary } from './state/useLibrary'
import { usePlaylists } from './state/usePlaylists'
import { usePlugins } from './state/usePlugins'
import { useSettings, watchSystemTheme } from './state/useSettings'
import { toast } from './state/useToasts'
import { routeFromPath, useUi, type NativeRoute } from './state/useUi'

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
  const mini = useUi((s) => s.mini)
  const miniPanel = useUi((s) => s.miniPanel)
  const started = useRef(false)

  /**
   * 迷你模式：界面状态在 useUi，**窗口几何在主进程** —— 这里把两边接上。
   *
   * 放在 App（而不是切迷你那颗按钮的 onClick 里）有两个理由：
   *   · 将来托盘、快捷键也能切它，状态一变就该同步，而不是「只有从底栏点的那一次才同步」；
   *   · 登出时要把窗口尺寸还回去（见下面那段），而那一刻 Shell 已经不在了 ——
   *     这条 effect 挂在 App 上才始终有效。
   */
  useEffect(() => {
    /*
      顺带挂到 <html> 上：toast、上下文菜单、提示这些是**挂在 body 上的另一棵子树**
      （不在 .shell 里面），只给 .shell 打标记够不着它们 —— 而迷你窗只有 64px 高，
      提示原本那 58px 的落点会被直接顶出窗外（见 components.css 里那条 html[data-mini]）。
    */
    document.documentElement.dataset.mini = mini ? 'true' : 'false'
    // 主进程只要知道「下方那块面板开没开」（装歌词还是队列由 MiniPlayer 自己定）
    void window.songloft.window.setMini({ mini, expanded: miniPanel !== null })
  }, [mini, miniPanel])

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

      /*
        Esc 收起满窗播放。刻意排在输入框那道判断**之后**：命令面板的 Esc 绑在它自己的输入框上
        （那是「关掉面板」），目标在输入框里时这里就该让开，否则一下把面板与满窗一起收掉。
      */
      if (event.key === 'Escape') {
        if (ui.fullPlayer) {
          event.preventDefault()
          ui.setFullPlayer(false)
        }
        return
      }

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
      // 迷你模式也得退出：登录页要摆在一个 400×64 的窗里是没法用的
      useUi.getState().setMini(false)
      // 满窗播放同样复位：它挂在原生面上，而登录页整块是另一套外壳。
      // 不复位的话，「开着满窗登出、再登录」会一进门就顶着一张播放器。
      useUi.getState().setFullPlayer(false)
      return
    }
    void usePlaylists.getState().load()
    void usePlaylists.getState().loadFavorites()
    void usePlayer.getState().restoreLastQueue()
    /*
     * 守望曲库的后台任务（扫描 / 刷新元数据）：进应用时服务端可能正在扫（上一次会话没跑完、
     * 或另一台客户端起的），那种情况下没有任何页面会去问进度 —— 由这里一直跟到它结束，
     * 结束时 useLibrary 会把号 +1，各处的曲库副本随之重取。见 state/useLibrary。
     */
    useLibrary.getState().watchTasks()
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

  const surface = useUi((s) => s.surface)
  const route = useUi((s) => s.nativeRoute)
  const panelOpen = useUi((s) => s.panelOpen)
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed)
  const mini = useUi((s) => s.mini)
  const miniRestore = useUi((s) => s.miniRestore)
  const fullPlayer = useUi((s) => s.fullPlayer)

  /**
   * 扩展面**第一次**被打开过没有（之后就一直挂着，见下面那段说明）。
   *
   * 为什么要这一道：没人打开过它的时候，挂上它只会在开机时白发几个请求（拉订阅源、
   * 刷新商店 —— 后者还可能要服务端去访问远端源）。所以等第一次真要用它再挂，
   * 从第一次之后就不再卸载了。
   */
  const [extensionsVisited, setExtensionsVisited] = useState(surface === 'extensions')
  useEffect(() => {
    if (surface === 'extensions') setExtensionsVisited(true)
  }, [surface])
  /**
   * 这一帧要不要挂上扩展面。
   *
   * 不能只看 `extensionsVisited`：它在 effect 里才置位，直接用它会让「第一次切过去」的
   * 那一帧**整块内容区是空的**。把当前这一面也算进来，第一次就是当场挂上。
   */
  const mountExtensions = extensionsVisited || surface === 'extensions'

  return (
    <div
      className="shell"
      data-surface={surface}
      data-mini={mini ? 'true' : undefined}
      /*
        藏起来的正常界面按进迷你之前的尺寸钉住（见 base.css 里 .shell[data-mini] 那段）：
        取的是 useUi 记下的那一份，而不是当前的 window.innerWidth —— 后者已经是 400px 了。
      */
      style={
        mini && miniRestore
          ? ({
              '--mini-restore-w': `${miniRestore.width}px`,
              '--mini-restore-h': `${miniRestore.height}px`
            } as React.CSSProperties)
          : undefined
      }
    >
      <TitleBar />

      {/*
        标题栏以下是**一个可替换的内容面**，两种形态：
          * native     —— 侧栏 + 工具条 + 主区 + 抽屉 + 播放条；
          * extensions —— 扩展主框架（左扩展侧栏 + 右内容面）。

        ★ 两面**都挂在 DOM 里**，只把不走的那一面藏起来（`.surface[data-hidden]`，用
          visibility 而不是 display —— 见 base.css 那段说明）。这样来回切时每一面都还是
          离开时的样子：原生面的滚动位置与已加载的列表、扩展面在商店的第几页、正在出声的
          那个扩展。反过来（谁走就卸载谁）会把这些全丢掉，而它们正是「记住状态」的全部内容。
          扩展面是**第一次打开之后**才挂上的（`extensionsVisited`），免得没人用它也白跑请求。

        两面各有一套自己的栅格：原生面是「上半 shell-body / 下半播放条」，扩展面整块交给
        框架（它自己再分左右两栏）。所以下面这两块的布局互不相干。
      */}
      <div className="surface surface-native" data-hidden={surface !== 'native'}>
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
              {renderRoute(route)}
            </div>
          </div>

          <Panel />
        </div>

        <PlayerBar />

        {/*
          满窗播放：盖在原生面**之上**（底栏那颗封面点出来，见 components/FullPlayer.tsx）。
          放在这一面里面而不是像 MiniPlayer 那样挂在 Shell 上：它跟着原生面一起被藏
          （切去扩展面、进迷你都不会孤零零留在屏幕上），切回来时又原样还在。
        */}
        {fullPlayer ? <FullPlayer /> : null}
      </div>

      {/* 第一次打开过之后就一直挂着（见上面 mountExtensions 的说明） */}
      {mountExtensions ? (
        <div className="surface surface-extensions" data-hidden={surface !== 'extensions'}>
          <ExtensionFrame />
        </div>
      ) : null}

      {/*
        迷你模式：上面那一整块（标题栏 + 两面）只是**藏起来**，不是卸载 —— 扩展面里可能
        正有插件在出声（音频不挂在布局上，藏起来也不断），而两面的滚动位置/已加载列表
        正是「切回来还是离开时的样子」的全部内容。真正显示的是这一条小播放条。
      */}
      {mini ? <MiniPlayer /> : null}

      <CommandPalette />
      <AddToPlaylistDialog />
      <ContextMenuHost />
      <TooltipHost />
      <Toasts />
    </div>
  )
}

function Toolbar(): React.JSX.Element {
  const route = useUi((s) => s.nativeRoute)
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

/**
 * 原生面的页面。
 *
 * 扩展那两条路由（`extensions` / `plugin`）**刻意不在这里** —— 它们不走主内容区，而是把
 * 标题栏以下整块换成扩展主框架（见 Shell 里那两块 `.surface`）。所以入参是 `NativeRoute`：
 * 哪天有人把扩展路由塞进来，类型检查会先拦住，而不是渲染出一块空白。
 */
function renderRoute(route: NativeRoute): React.JSX.Element {
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
    // NativeRoute 在上面已经穷举完了，这一条只是让「将来漏了一条」不会变成白屏
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

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
 * 用 started ref 兜住，避免 HMR 或多次挂载把它们接两遍。
 *
 * ★ 有一样**不能**这么兜：迷你窗那两条接线（开关状态的回声 + 状态推送）。它单独一个 effect
 *   装卸，理由写在那一节 —— 一次性守卫会把「卸下之后的重装」一并挡掉，而严格模式恰好每次都
 *   卸下再重装，于是那条线在 dev 里是断的。
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
import { Panel } from './components/Panel'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { TooltipHost } from './components/Tooltip'
import { useResponsiveSidebar } from './hooks/useResponsiveSidebar'
import { PageActiveProvider } from './hooks/usePageActive'
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
import { installMiniHost } from './state/mini-host'
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
import { routeFromPath, useUi, type NativeRoute, type Surface } from './state/useUi'

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

  /* ── 迷你窗那两条接线（可以、也必须反复装卸）────────────────────── */
  /*
   * 一条是 installMiniHost()：把播放状态推给迷你窗、把它发来的遥控命令落到真播放器上
   * （见 state/mini-host.ts）。装在这里而不是某个组件里，因为全应用只有**这一个**真播放器
   * （就在这个窗口里）；也不能等下面那段启动编排（读设置 → 校验会话）走完 —— 底栏那颗按钮
   * 随时可能被点，而它点什么都要靠这两条。
   * 另一条是「迷你窗此刻开着没有」：底栏那颗按钮的高亮要看它（窗口是主进程开的，渲染层没有
   * 别的渠道知道这件事）。两条都走模块级订阅而不是 React —— 它们只影响一个布尔量与几份快照，
   * 让整棵界面树为它重渲染一次不划算（理由同 ContextMenuHost 那条 dataset）。
   *
   * ★★ 这一段**刻意不放进下面那个带一次性守卫的 effect**里，这坑已经踩过：
   *   严格模式（dev）会「挂上 → 卸下 → 再挂上」，而守卫让第二次挂载直接 return ——
   *   于是第一次挂上、又被那次卸下拆掉的订阅**再也装不回来**：迷你窗从此收不到任何状态
   *   （表现是它一直停在「未在播放」，底栏那颗按钮也不会变成按下态），dev 里 100% 复现。
   *   同样的写法在 MiniApp.tsx 里已经踩过一次（见那里的注释），这里是同一个理由。
   * ★ 重装是安全的：installMiniHost 自己会在装上时问一句「迷你窗现在开着没有」，
   *   所以 HMR 重新挂载、渲染层刷新之后推送能自己接上（见 IPC.miniIsOpen）。
   */
  useEffect(() => {
    const disposeHost = installMiniHost()
    const disposeOpen = window.songloft.mini.onOpen((open) => useUi.getState().setMiniOpen(open))
    return () => {
      disposeHost()
      disposeOpen()
    }
  }, [])

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
      /*
       * 迷你窗也得关掉：登录页在那边没有对应界面（那一窗只有一条播放条 + 一块面板），
       * 而它显示的播放状态正是这里刚清空的东西 —— 留着就是一个点不动的空条。
       */
      void window.songloft.mini.setOpen(false)
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
      /* 满窗播放：标题栏那一层的底色也跟着换（见 components.css 里 .shell[data-fullplayer]） */
      data-fullplayer={fullPlayer ? 'true' : undefined}
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
            {/*
              主内容区：**所有去过的页面都挂在这里**，走的那一页只是被藏起来
              （见下面 NativePages 的说明）。所以这里没有 key —— 路由变化不再卸载重建。
              （原先那个 key={route.name} 是「换页就重来」：列表与封面每次都被冲掉，
              页面里的筛选、排序、滚动位置也跟着没了。）
            */}
            <div className="main-scroll">
              <NativePages route={route} surface={surface} />
            </div>
          </div>

          <Panel />
        </div>

        <PlayerBar />

        {/*
          满窗播放：盖在原生面**之上**（底栏那颗封面点出来，见 components/FullPlayer.tsx）。
          放在这一面里面而不是挂在 Shell 上：它跟着原生面一起被藏（切去扩展面时不会孤零零
          留在屏幕上），切回来时又原样还在。
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
        ★ 这里**不再有**迷你播放器：它是另一个窗口里的一棵独立界面树（components/MiniPlayer.tsx
          + MiniApp.tsx），底栏那颗按钮只是开 / 关那个窗（见 PlayerBar 的 mini 按钮）。
          以前那套「把这一整块藏起来、钉住尺寸、让 <html> 带 data-mini」的机制（连同
          --mini-restore-w/h）都随之去掉了：主窗口从此不必为迷你条改尺寸或重排任何东西。
      */}

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
 * 原生面的页面槽名：一条原生路由一个槽。
 *
 * ★ `library` 与 `folders` 虽然落在同一个组件里（见 LibraryPage：同一页的两个标签），
 *   仍然**各占一个槽** —— 一个槽的话，两个标签就是在同一个实例里换渲染分支，
 *   切过去会把「曲库」那一半的筛选条件与模式一并卸掉，而它们正是切回来时要留住的东西。
 *   两个槽各留一份，标签条在两边各画一次（只显示一个，看不出重复）。
 */
type PageSlotName = NativeRoute['name']

/** 槽的顺序（固定即可，只为让 DOM 有个稳定次序） */
const PAGE_SLOTS: readonly PageSlotName[] = [
  'home',
  'library',
  'folders',
  'favorites',
  'recent',
  'search',
  'playlists',
  'playlist',
  'settings'
]

/**
 * 原生面的页面槽：**去过的页面都挂着，只藏不走**。
 *
 * ★ 与两面之间用的是同一套办法（见文件头与 base.css 里 `.surface` 那段），理由也一样：
 *   切页时若把离开的那一页卸载掉，它里面的一切就都没了 —— 曲库的筛选条件与排序方式、
 *   歌单页的视图模式（网格/列表）、歌单详情里在歌单内筛的关键词、滚动到哪儿了。
 *   而这些正是用户切回来时期待的「还是我离开时的样子」。
 *
 *   代价是数据的新鲜度不再由「重新挂载」自动保证，改由数据 hook 自己盯：切回来时静默
 *   重取一次，**数据没变就一个字都不改**（见 hooks/usePageActive 与三个数据 hook）。
 *
 * ★ 只藏不卸载的另一个后果是 DOM 里同时存在好几页，所以不活跃的槽带 `data-hidden`：
 *   它让那一页不画、不收事件、不进 tab 序（CSS 里是 visibility: hidden，不是 display: none
 *   —— 后者会让页面失去布局，滚动位置与已加载的列表就不再保证），也让 E2E 那份全局选择器
 *   能把范围收回当前这一页（见 scripts/e2e/drive.mjs 的 `vis()`）。
 *
 * ★ **首次访问才挂**：没人去过的页面不该在开机时就替它发请求（与扩展面的 mountExtensions
 *   同一个理由）。挂上之后就不再卸载，所以「第一次切过去」的那一帧也要算进去
 *   （`name === route.name`），否则会白一帧。
 */
function NativePages({
  route,
  surface
}: {
  route: NativeRoute
  surface: Surface
}): React.JSX.Element {
  /*
   * 每个槽最后停在的那条路由。非活跃槽必须用「自己离开时的那一份」，而不是当前 route
   * —— 后者只有一条、属于活跃槽，而歌单详情 / 文件夹 / 搜索都要靠各自那份参数渲染
   * （共用一份的话，它们会被别人的参数覆盖成另一个歌单、另一个目录）。
   */
  const lastRoutes = useRef<Partial<Record<PageSlotName, NativeRoute>>>({})
  lastRoutes.current[route.name] = route

  const [visited, setVisited] = useState<ReadonlySet<PageSlotName>>(() => new Set([route.name]))
  useEffect(() => {
    setVisited((prev) => (prev.has(route.name) ? prev : new Set(prev).add(route.name)))
  }, [route.name])

  return (
    <>
      {PAGE_SLOTS.filter((name) => name === route.name || visited.has(name)).map((name) => {
        const slotRoute = lastRoutes.current[name]
        if (!slotRoute) return null
        return (
          // 活跃 = 既在原生面上，又正是当前这一页（切去扩展面时，面上的页面一起停摆）
          <PageSlot key={name} active={surface === 'native' && name === route.name}>
            {renderRoute(slotRoute)}
          </PageSlot>
        )
      })}
    </>
  )
}

/** 一个页面槽。active 同时经 context 告诉页面里的数据 hook「你现在看得见吗」 */
function PageSlot({
  active,
  children
}: {
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="page-slot" data-hidden={active ? undefined : 'true'}>
      <PageActiveProvider value={active}>{children}</PageActiveProvider>
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
      return <LibraryPage route={route} />
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

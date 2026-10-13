/**
 * 自绘标题栏。
 *
 * 窗口是 frame: false 的，所以窗口控制要自己画。三条容易做错的：
 *   1. 拖动区必须 `-webkit-app-region: drag`，且**交互控件要显式 no-drag**，
 *      否则按钮点不动（点在 drag 区域上的事件会被拿去拖窗口）；
 *   2. 双击标题栏要能最大化/还原，这是桌面系统的肌肉记忆；
 *   3. 最大化状态要从主进程推过来，不能靠本地猜（用户用键盘快捷键也可能改）。
 *
 * ★ 未登录（solo）时也要渲染这个组件：窗口是 frameless 的，全部拖拽能力都来自
 *   `.titlebar` 的 -webkit-app-region —— 登录页若不带标题栏，那个窗口就既拖不动、
 *   也关不掉（只能靠 Alt+F4）。所以 App 在任何状态下都把标题栏放在最外层，
 *   这里只是把「导航菜单 / 搜索」这类需要已登录的元素藏起来。
 *
 * 布局：`[logo] ⟨弹性空档⟩ [导航菜单][搜索][窗口控制]`。
 * 中间刻意**不再显示当前曲目** —— 那块地方要留给扩展入口条（见 ExtensionStrip），
 * 而曲目信息本来在播放条与右侧抽屉里各有一份。
 */

import { useEffect, useState } from 'react'

import {
  IconClock,
  IconClose,
  IconHeart,
  IconHome,
  IconLibrary,
  IconListMusic,
  IconMaximize,
  IconMenu,
  IconMinimize,
  IconRestore,
  IconSearch,
  IconSettings
} from './Icons'
import { useContextMenu, type MenuItem } from './ContextMenu'
import { Cover } from './primitives'
import { useUi } from '@/state/useUi'
import { regularPlaylists, usePlaylists } from '@/state/usePlaylists'

export interface TitleBarProps {
  /** 未登录/启动中：只保留窗口控制，去掉需要登录态的元素 */
  solo?: boolean
}

export function TitleBar({ solo = false }: TitleBarProps): React.JSX.Element {
  const [state, setState] = useState({ maximized: false, fullscreen: false, focused: true })
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const navigate = useUi((s) => s.navigate)
  /** 只为把 aria-expanded 说出来：读的是宿主的真实状态，而不是本地另存一份 */
  const navMenuOpen = useContextMenu((s) => s.open)
  const playlists = usePlaylists((s) => s.playlists)
  // 与侧栏「我的歌单」用同一个过滤器，两处名单不会各自漂移
  const myPlaylists = regularPlaylists(playlists)

  useEffect(() => {
    void window.songloft.window.getState().then(setState)
    return window.songloft.on.windowState(setState)
  }, [])

  /**
   * 双击标题栏空白处 = 最大化/还原。
   *
   * 为什么要在 JS 里补一手：拖拽区（`-webkit-app-region: drag`）在 Windows 上会被
   * 当成非客户区交给系统处理，事件根本送不到页面；Linux 上则不会自动最大化。两边都
   * 给同一个入口才有一致行为 —— 系统处理过的事件不会冒到这里，所以不会重复切换。
   *
   * 落在窗口按钮上的双击要排除：那些按钮是 no-drag 区，本来就能收到事件，
   * 「双击最小化按钮」不该顺带把窗口最大化。
   */
  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return
    void window.songloft.window.toggleMaximize()
  }

  /**
   * 折叠菜单的菜单项：按「浏览 → 收藏与历史 → 设置」排。
   * 只放「去哪儿」不放管理动作；「文件夹」不单列 —— 它是曲库页里的一个标签。
   *
   * 复用 ContextMenuHost 而不是自己造一个下拉：宿主已经处理了贴边翻转、Esc、失焦关闭，
   * 再造一份就是两份要同步维护的行为。代价是必须把触发器一起传进去 —— 见 ContextMenu.tsx
   * 里 anchor 的说明（不传的话「再点一次收起」做不出来）。
   */
  const navMenuItems = (): MenuItem[] => [
    {
      key: 'home',
      label: '首页',
      icon: <IconHome size={16} />,
      onClick: () => navigate({ name: 'home' })
    },
    {
      key: 'library',
      label: '曲库',
      icon: <IconLibrary size={16} />,
      onClick: () => navigate({ name: 'library' })
    },

    {
      key: 'playlists',
      label: '歌单',
      icon: <IconListMusic size={16} />,
      /**
       * 「双面」项：悬浮列出歌单名单（跳到某个歌单的捷径），单击进歌单列表页 ——
       * 想直奔某个歌单还是想先看总览，两种意图都不必再绕一步。
       * 名单为空时给一条不可点的说明，而不是弹一个空框 —— 空框会让人以为是坏了。
       */
      onClick: () => navigate({ name: 'playlists' }),
      children: myPlaylists.length
        ? myPlaylists.map((playlist) => ({
            key: `playlist-${playlist.id}`,
            label: playlist.name,
            icon: (
              <Cover
                coverUrl={playlist.cover_url}
                width={48}
                size={20}
                radius={4}
                kind="playlist"
              />
            ),
            onClick: () => navigate({ name: 'playlist', id: playlist.id })
          }))
        : [{ key: 'playlists-empty', label: '还没有歌单', disabled: true }]
    },
    {
      key: 'favorites',
      label: '我喜欢',
      icon: <IconHeart size={16} />,
      onClick: () => navigate({ name: 'favorites' })
    },
    {
      key: 'recent',
      label: '最近播放',
      icon: <IconClock size={16} />,
      onClick: () => navigate({ name: 'recent' })
    },
    // 设置与上面那串「去哪儿」不是一类：分割线把这一段单独划出来
    { key: 'sep-settings', label: '', separator: true },
    {
      key: 'settings',
      label: '设置',
      icon: <IconSettings size={16} />,
      onClick: () => navigate({ name: 'settings', section: 'appearance' })
    }
  ]

  const toggleNavMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const menu = useContextMenu.getState()
    // 宿主对「点触发器」刻意不关（anchor），所以这里读到的仍是开着 → 收起
    if (menu.open) {
      menu.hide()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    menu.show(rect.left, rect.bottom + 6, navMenuItems(), { anchor: event.currentTarget })
  }

  return (
    <header className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar-brand">
        {/* 点它 = 回播放页（首页）。它落在拖拽区里，靠 base.css 的
            `.titlebar button { -webkit-app-region: no-drag }` 才点得动。 */}
        <button
          type="button"
          className="titlebar-home"
          data-tip="回到播放页"
          aria-label="回到播放页"
          onClick={() => navigate({ name: 'home' })}
        >
          <img src="./icon.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <span>Songloft</span>
        </button>
      </div>

      {/* 纯弹性空档：撑住拖拽区，也让右侧那组始终贴右缘 */}
      <div className="titlebar-center" />

      <div className="titlebar-actions">
        {!solo ? (
          <button
            type="button"
            className="win-btn"
            data-tip="导航菜单"
            aria-label="导航菜单"
            aria-haspopup="menu"
            aria-expanded={navMenuOpen}
            onClick={toggleNavMenu}
          >
            <IconMenu size={16} />
          </button>
        ) : null}
        {!solo ? (
          <button
            type="button"
            className="win-btn"
            data-tip="搜索与命令（Ctrl+K）"
            aria-label="打开命令面板"
            onClick={() => setPaletteOpen(true)}
          >
            <IconSearch size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="win-btn"
          data-tip="最小化"
          aria-label="最小化"
          onClick={() => void window.songloft.window.minimize()}
        >
          <IconMinimize size={15} />
        </button>
        <button
          type="button"
          className="win-btn"
          data-tip={state.maximized ? '还原' : '最大化'}
          aria-label={state.maximized ? '还原' : '最大化'}
          onClick={() => void window.songloft.window.toggleMaximize()}
        >
          {state.maximized ? <IconRestore size={15} /> : <IconMaximize size={14} />}
        </button>
        <button
          type="button"
          className="win-btn"
          data-variant="close"
          data-tip="关闭"
          aria-label="关闭"
          onClick={() => void window.songloft.window.close()}
        >
          <IconClose size={15} />
        </button>
      </div>
    </header>
  )
}

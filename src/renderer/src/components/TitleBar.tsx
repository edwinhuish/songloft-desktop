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
 *   这里只是把「搜命令面板 / 当前曲目」这类需要已登录的元素藏起来。
 */

import { useEffect, useState } from 'react'

import { IconClose, IconMaximize, IconMinimize, IconRestore, IconSearch } from './Icons'
import { useUi } from '@/state/useUi'
import { usePlayer } from '@/state/usePlayer'
import { displayArtist } from '@/lib/format'

export interface TitleBarProps {
  /** 未登录/启动中：只保留窗口控制，去掉需要登录态的元素 */
  solo?: boolean
}

export function TitleBar({ solo = false }: TitleBarProps): React.JSX.Element {
  const [state, setState] = useState({ maximized: false, fullscreen: false, focused: true })
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const song = usePlayer((s) => (s.cursor >= 0 && s.cursor < s.order.length ? s.queue[s.order[s.cursor]] : null))

  useEffect(() => {
    void window.songloft.window.getState().then(setState)
    return window.songloft.on.windowState(setState)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src="./icon.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        <span>Songloft</span>
      </div>

      <div className="titlebar-center">
        {!solo && song ? (
          <div className="truncate" style={{ maxWidth: 460, fontSize: 12.5, color: 'var(--text-3)' }}>
            <span style={{ color: 'var(--text-2)' }}>{song.title}</span>
            <span> — {displayArtist(song.artist)}</span>
          </div>
        ) : null}
      </div>

      <div className="titlebar-actions">
        {!solo ? (
          <button
            type="button"
            className="win-btn"
            title="搜索与命令（Ctrl+K）"
            aria-label="打开命令面板"
            onClick={() => setPaletteOpen(true)}
          >
            <IconSearch size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="win-btn"
          title="最小化"
          aria-label="最小化"
          onClick={() => void window.songloft.window.minimize()}
        >
          <IconMinimize size={15} />
        </button>
        <button
          type="button"
          className="win-btn"
          title={state.maximized ? '还原' : '最大化'}
          aria-label={state.maximized ? '还原' : '最大化'}
          onClick={() => void window.songloft.window.toggleMaximize()}
        >
          {state.maximized ? <IconRestore size={15} /> : <IconMaximize size={14} />}
        </button>
        <button
          type="button"
          className="win-btn"
          data-variant="close"
          title="关闭"
          aria-label="关闭"
          onClick={() => void window.songloft.window.close()}
        >
          <IconClose size={15} />
        </button>
      </div>
    </header>
  )
}

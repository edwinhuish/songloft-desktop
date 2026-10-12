/**
 * 自绘标题栏。
 *
 * 窗口是 frame: false 的，所以窗口控制要自己画。三条容易做错的：
 *   1. 拖动区必须 `-webkit-app-region: drag`，且**交互控件要显式 no-drag**，
 *      否则按钮点不动（点在 drag 区域上的事件会被拿去拖窗口）；
 *   2. 双击标题栏要能最大化/还原，这是桌面系统的肌肉记忆；
 *   3. 最大化状态要从主进程推过来，不能靠本地猜（用户用键盘快捷键也可能改）。
 */

import { useEffect, useState } from 'react'

import { IconClose, IconMaximize, IconMinimize, IconRestore, IconSearch } from './Icons'
import { useUi } from '@/state/useUi'
import { usePlayer } from '@/state/usePlayer'
import { displayArtist } from '@/lib/format'

export function TitleBar(): React.JSX.Element {
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
        {song ? (
          <div className="truncate" style={{ maxWidth: 460, fontSize: 12.5, color: 'var(--text-3)' }}>
            <span style={{ color: 'var(--text-2)' }}>{song.title}</span>
            <span> — {displayArtist(song.artist)}</span>
          </div>
        ) : null}
      </div>

      <div className="titlebar-actions">
        <button
          type="button"
          className="win-btn"
          title="搜索与命令（Ctrl+K）"
          aria-label="打开命令面板"
          onClick={() => setPaletteOpen(true)}
        >
          <IconSearch size={15} />
        </button>
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

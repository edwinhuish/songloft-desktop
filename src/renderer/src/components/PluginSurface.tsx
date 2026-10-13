/**
 * 扩展页承载层 —— 标题栏以下的那一整块内容面。
 *
 * 两种内容二选一，由 App 按路由决定：原生页（播放器 / 设置 / 扩展管理）或这里的
 * 扩展 webview。视觉上永远只有一个槽位，实现上却是一个**栈**：
 *
 *   ★ 正在出声的扩展必须活着。若切走就销毁，那「这个扩展正在播放音乐」这个角标根本
 *     无从谈起 —— 声音都没了。所以「活着的 = 当前显示的那个 ∪ 正在播放的那些」，
 *     其余一律销毁，进程占用自然收敛，不需要用户配置。
 *
 * 为什么是 `<webview>` 而不是 `<iframe>`：iframe 是跨源的，父页面没有任何 API 能
 * 单独静音它、也没法知道它在不在出声（`webContents.setAudioMuted` 是整窗口级的，
 * 会连播放器一起静音）。`<webview>` 的 guest 有 `setAudioMuted` 与
 * `media-started-playing` / `media-paused`，正好是需求要的那两件事。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  PLUGIN_PARTITION,
  pluginDisplayName,
  pluginPageUrl,
  type JSPlugin,
  type PluginPageContext
} from '@shared/plugin'
import { IconAlert, IconLoader, IconRefresh } from './Icons'
import { useAuth } from '@/state/useAuth'
import { usePlugins } from '@/state/usePlugins'
import { useSettings } from '@/state/useSettings'

/**
 * 我们用到的那部分 `<webview>` API。
 *
 * 刻意**不复用** `Electron.WebviewTag`：渲染层不许 import electron（eslint 会拦），
 * 而 electron 的类型也不在 tsconfig.web 的程序里。这里只声明真正调用的成员，
 * 少一个都不写 —— 未知的成员在这里就是编译错误，而不是运行时的静默失效。
 */
interface PluginWebviewHandle {
  setAudioMuted(muted: boolean): void
  reload(): void
  addEventListener(type: string, listener: (event: Event) => void, useCapture?: boolean): void
  removeEventListener(type: string, listener: (event: Event) => void, useCapture?: boolean): void
}

/** 加载兜底时限：跨源页面内部崩了我们一无所知，只能靠时间判断 */
const LOAD_TIMEOUT_MS = 15_000

export interface PluginSurfaceProps {
  /** 当前要显示的扩展 */
  entryPath: string
}

export function PluginSurface({ entryPath }: PluginSurfaceProps): React.JSX.Element {
  const plugins = usePlugins((state) => state.plugins)
  const loaded = usePlugins((state) => state.loaded)
  const runtime = usePlugins((state) => state.runtime)
  const ctx = usePluginPageContext()

  const alive = useMemo(() => {
    const wanted = new Set<string>([entryPath])
    for (const [path, state] of Object.entries(runtime)) {
      if (state.playing) wanted.add(path)
    }
    // 只保留**还装着**的：插件被卸载后它的 webview 该跟着消失，而不是留在后台占进程
    return plugins.filter((plugin) => wanted.has(plugin.entryPath))
  }, [entryPath, runtime, plugins])

  // 插件列表还没回来时不要急着说「不存在」，否则冷启动进扩展页会闪一下错误
  if (!loaded) {
    return (
      <div className="plugin-surface">
        <div className="plugin-view-overlay" data-state="loading">
          <IconLoader size={20} />
          <span>正在打开扩展…</span>
        </div>
      </div>
    )
  }

  if (!plugins.some((plugin) => plugin.entryPath === entryPath)) {
    return (
      <div className="plugin-surface">
        <div className="plugin-view-overlay" data-state="failed">
          <IconAlert size={20} />
          <span>这个扩展已经不在了</span>
          <span className="plugin-view-hint">它可能已被卸载或停用</span>
        </div>
      </div>
    )
  }

  return (
    <div className="plugin-surface">
      {alive.map((plugin) => (
        <ExtensionView
          key={plugin.entryPath}
          plugin={plugin}
          active={plugin.entryPath === entryPath}
          ctx={ctx}
        />
      ))}
    </div>
  )
}

/* ─────────────────────────────── 单个扩展 ─────────────────────────────── */

interface ExtensionViewProps {
  plugin: JSPlugin
  /** 当前是否正在被显示（其余是后台保活） */
  active: boolean
  ctx: PluginPageContext
}

function ExtensionView({ plugin, active, ctx }: ExtensionViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<PluginWebviewHandle | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  const entryPath = plugin.entryPath
  const url = useMemo(() => pluginPageUrl(plugin, ctx), [plugin, ctx])
  const muted = usePlugins((state) => state.runtime[entryPath]?.muted ?? false)
  const setRuntime = usePlugins((state) => state.setRuntime)

  /**
   * 建 / 毁 webview。
   *
   * 为什么手写 createElement 而不是 JSX：`<webview>` 的媒体事件没有对应的 React prop，
   * 监听只能自己挂；而渲染层拿不到它的类型声明（见 PluginWebviewHandle 的注释）。
   * 与其为它编一套 JSX 类型，不如直接操作那个 DOM 节点 —— 反正它从头到尾都是命令式的。
   *
   * `url` 变化即整体重建：扩展页的 access_token 写在 URL 里，交给后端注入的
   * auth-bridge 存进 localStorage。要换 token 只能重新导航一次把它送进去。
   */
  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return

    setStatus('loading')
    const view = document.createElement('webview') as unknown as PluginWebviewHandle & HTMLElement
    view.className = 'plugin-webview'
    // 独立 session：宿主给 defaultSession 注入的 CSP 会连插件页一起改写（见 PLUGIN_PARTITION）
    view.setAttribute('partition', PLUGIN_PARTITION)
    view.setAttribute('src', url)
    viewRef.current = view

    const started = (): void => setRuntime(entryPath, { playing: true })
    const paused = (): void => setRuntime(entryPath, { playing: false })
    const ready = (): void => setStatus('ready')
    const failed = (event: Event): void => {
      // -3 是 ABORTED（正常的导航取消，换 token 重建时必然出现），不算失败
      const code = (event as Event & { errorCode?: number }).errorCode
      if (code === -3) return
      setStatus('failed')
    }

    view.addEventListener('media-started-playing', started)
    view.addEventListener('media-paused', paused)
    view.addEventListener('did-finish-load', ready)
    view.addEventListener('did-fail-load', failed)
    host.appendChild(view)

    return () => {
      view.removeEventListener('media-started-playing', started)
      view.removeEventListener('media-paused', paused)
      view.removeEventListener('did-finish-load', ready)
      view.removeEventListener('did-fail-load', failed)
      viewRef.current = null
      view.remove()
      // 销毁即不可能再出声。不复位的话，入口条上会永远留着一枚不再更新的「播放中」
      setRuntime(entryPath, { playing: false })
    }
  }, [url, entryPath, setRuntime])

  /**
   * 静音落到 guest 上。
   *
   * 依赖里带 `url` 是必要的：换 token 会重建 webview，新节点得重新套一次静音状态，
   * 否则用户明明静音了，刷新一次又响了。
   */
  useEffect(() => {
    viewRef.current?.setAudioMuted(muted)
  }, [muted, url])

  /**
   * 兜底超时。
   *
   * 跨源页面读不到 contentDocument：插件页脚本崩了、或者后端根本不可达，我们这边都
   * 无从得知。与其让用户对着空白发呆，不如给一句「没加载出来 + 重试」。正常加载会先
   * 触发 did-finish-load，这个计时器只在真的挂了时才兑现。
   */
  useEffect(() => {
    if (status !== 'loading') return
    const timer = setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'failed' : current))
    }, LOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [status, url])

  const retry = (): void => {
    setStatus('loading')
    viewRef.current?.reload()
  }

  return (
    <div className="plugin-view" data-active={active ? 'true' : 'false'}>
      <div className="plugin-view-host" ref={hostRef} />

      {active && status !== 'ready' ? (
        <div className="plugin-view-overlay" data-state={status}>
          {status === 'loading' ? <IconLoader size={20} /> : <IconAlert size={20} />}
          <span>{status === 'loading' ? '正在打开扩展…' : '扩展页没能加载出来'}</span>
          {status === 'failed' ? (
            <>
              <span className="plugin-view-hint">
                {pluginDisplayName(plugin)} · 确认后端可达后重试
              </span>
              <button type="button" className="btn" data-size="sm" onClick={retry}>
                <IconRefresh size={14} />
                重新加载
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────── 上下文 ─────────────────────────────── */

/**
 * 扩展页地址要的那点上下文。
 *
 * token 取自 store 的镜像（而不是 `client.getAccessToken()`）：刷 token 时必须触发
 * 重渲染，否则扩展页会一直挂着过期的那一份，插件里的请求全 401。
 */
function usePluginPageContext(): PluginPageContext {
  const baseUrl = useAuth((state) => state.baseUrl)
  const accessToken = useAuth((state) => state.accessToken)
  const themeSetting = useSettings((state) => state.settings.theme)

  return useMemo(() => {
    const theme: 'dark' | 'light' =
      themeSetting === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : themeSetting
    return { baseUrl: baseUrl ?? '', accessToken, theme }
  }, [baseUrl, accessToken, themeSetting])
}

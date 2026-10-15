/**
 * 扩展 webview 的承载层 —— 扩展主框架右侧那一栏的内容面（见 ExtensionFrame）。
 *
 * 它在框架里**常驻**（哪怕当前显示的是插件商店 / 插件管理，只是被藏起来），
 * 视觉上永远只有一个槽位，实现上却是一个**栈**：
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
 *
 * ★ 下面这两个方法都**不是**「拿到元素就能调」：它们内部要先 `getWebContentsId()`，
 *   而那个 id 只有在元素已插入 DOM **并且 guest 已经 `dom-ready`** 之后才存在。违反这条
 *   时序会抛 `The WebView must be attached to the DOM and the dom-ready event emitted…`，
 *   而且它抛在 effect 里、会连带把整个组件树掀掉。所以调用方一律要先过 `guestReady` 这一关。
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
  /**
   * 当前要显示的扩展；**空串 = 一个都不显示，只保活正在出声的那些**。
   *
   * 空串这一档是给扩展主框架用的：用户切到「插件商店」时那个 webview 只是被藏起来
   * （框架把它整块 display:none），不能因此被销毁 —— 否则点一下「插件管理」就把
   * 正在放的歌掐了（见 ExtensionFrame 的说明）。
   */
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
  // （entryPath 为空时连这一句都不必：我们本来就没打算显示任何东西）
  if (!loaded && entryPath) {
    return (
      <div className="plugin-surface">
        <div className="plugin-view-overlay" data-state="loading">
          <IconLoader size={20} />
          <span>正在打开扩展…</span>
        </div>
      </div>
    )
  }

  // 空串这一档没有「要显示的那个」，自然也就谈不上「它不在了」
  if (entryPath && !plugins.some((plugin) => plugin.entryPath === entryPath)) {
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
  /**
   * guest 是否已经就绪（`dom-ready`）。
   *
   * 元素插进 DOM 与 guest 真正建好是**两件事**：appendChild 只是排上队。在那之前
   * `setAudioMuted` / `reload` 都会抛（见 PluginWebviewHandle 的注释）。
   *
   * 这是 state 而不是 ref：静音那个 effect 要在它翻成 true 时**再跑一次**，把用户
   * 早就设置好的静音补上去。
   */
  const [guestReady, setGuestReady] = useState(false)
  /** 换一个值即整体重建 webview。给「重试」用 —— guest 没起来时不能再 reload */
  const [buildToken, setBuildToken] = useState(0)

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
    // 旧 guest 已经随上一个 effect 的清理被丢掉了，先把它那一份「就绪」作废
    setGuestReady(false)

    const view = document.createElement('webview') as unknown as PluginWebviewHandle & HTMLElement
    view.className = 'plugin-webview'
    // 独立 session：宿主给 defaultSession 注入的 CSP 会连插件页一起改写（见 PLUGIN_PARTITION）
    view.setAttribute('partition', PLUGIN_PARTITION)
    /**
     * ★ 这一条是插件页里那些链接能不能点开的关键，别顺手删掉。
     *
     * 不给 `allowpopups` 时，guest 里的 `window.open` 与 `<a target="_blank">` 会被直接
     * 丢弃：请求根本到不了主进程那个 `setWindowOpenHandler`（`deny` + `shell.openExternal`，
     * 见 main/index.ts 的 hardenPluginSession）。症状是**点了没反应**，而且不报错、
     * 控制台一行都没有 —— 在 guest 里查不出任何东西，只能靠这一处对。
     *
     * 放开的只是「允许发出新窗口请求」，落不落地由那个 handler 说了算：一律 deny，
     * 真正被打开的是系统浏览器。所以它不是把窗口开给了第三方插件。
     */
    view.setAttribute('allowpopups', 'true')
    view.setAttribute('src', url)
    viewRef.current = view

    const started = (): void => setRuntime(entryPath, { playing: true })
    const paused = (): void => setRuntime(entryPath, { playing: false })
    const domReady = (): void => setGuestReady(true)
    const loaded = (): void => setStatus('ready')
    const failed = (event: Event): void => {
      // -3 是 ABORTED（正常的导航取消，换 token 重建时必然出现），不算失败
      const code = (event as Event & { errorCode?: number }).errorCode
      if (code === -3) return
      setStatus('failed')
    }

    view.addEventListener('media-started-playing', started)
    view.addEventListener('media-paused', paused)
    // ★ dom-ready 标记的是「guest 建好了，能调它的方法了」，与「页面加载完成」是两回事
    view.addEventListener('dom-ready', domReady)
    view.addEventListener('did-finish-load', loaded)
    view.addEventListener('did-fail-load', failed)
    host.appendChild(view)

    return () => {
      view.removeEventListener('media-started-playing', started)
      view.removeEventListener('media-paused', paused)
      view.removeEventListener('dom-ready', domReady)
      view.removeEventListener('did-finish-load', loaded)
      view.removeEventListener('did-fail-load', failed)
      viewRef.current = null
      view.remove()
      // 销毁即不可能再出声。不复位的话，扩展侧栏里会永远留着一枚不再更新的「播放中」
      setRuntime(entryPath, { playing: false })
    }
  }, [url, entryPath, setRuntime, buildToken])

  /**
   * 静音落到 guest 上。
   *
   * 依赖里的三项都不是多余的：
   *   * `guestReady` —— 首次静音必须等到 guest 建好，否则直接抛（这就是它曾经的样子）；
   *   * `url`        —— 换 token 会重建 webview，新节点得重新套一次，
   *                     否则用户明明静音了，刷新一次又响了。
   */
  useEffect(() => {
    if (!guestReady) return
    viewRef.current?.setAudioMuted(muted)
  }, [muted, guestReady, url])

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
  }, [status, url, buildToken])

  /**
   * 重试。
   *
   * 分两种情况，不能一律 reload：guest 建好过（`guestReady`）说明只是这次导航失败，
   * reload 最快；**没建好**（连接被拒这类，`dom-ready` 根本没来过）时 reload 会抛，
   * 只能整个换掉这个元素重建一次。
   */
  const retry = (): void => {
    setStatus('loading')
    if (guestReady) viewRef.current?.reload()
    else setBuildToken((token) => token + 1)
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

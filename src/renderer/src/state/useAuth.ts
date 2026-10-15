/**
 * 会话与服务器。
 *
 * 三件事绑在一起管，因为它们互相决定：
 *   * ApiClient 实例（谁在发请求）
 *   * 凭据（谁是当前用户）—— 落主进程，按服务器 URL 隔离（walletKey 语义）
 *   * 媒体 URL 的基准地址（302 解析后的真实 origin）
 *
 * 启动流程刻意做成「先读磁盘 → 校验一次轻量认证请求 → 才决定进哪一层」，
 * 而不是直接把用户丢进主界面再弹一个「登录失效」。
 *
 * ★ 落点由 `guest` 一位决定（默认 true，也就是**免登录是默认形态**）：没会话就进主界面
 *   （只听本机文件，曲库那几页自己让开），**登录页只在用户自己要去时出现**
 *   —— 侧栏那颗「连接服务器」、设置里的「切换账号」、退出登录，以及「存着的凭据已失效」
 *   这一种需要人就地补密码的情况（见 bootstrap）。
 */

import { create } from 'zustand'
import { ApiError, ApiClient, type TokenPair } from '@/api/client'
import { getSongs, login as loginRequest, logout as logoutRequest } from '@/api/endpoints'
import type { ResourceContext } from '@/lib/url'
import type { ServerEntry, ServerProbeResult } from '@shared/ipc'
import { useSettings } from './useSettings'

export type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated'

interface AuthState {
  status: AuthStatus
  /**
   * 免登录形态：不连任何服务器，只听本地文件。**这是默认形态**（没有会话时默认进主界面，
   * 不必先点一个「免登录使用」）。
   *
   * ★ 为什么是独立的一位、而不是往 status 里再加一档：status 答的是「与服务器现在是什么
   *   关系」（还在恢复 / 没登录 / 已登录），而「免登录用一用」与它**正交** —— 免登录进来
   *   之后照样可以再登录，那时这一位自然失去意义。
   * ★ 它管的只有一件事：**没有会话时进主界面还是进登录页**（true = 主界面）。有会话时它
   *   一律是 false（见 bootstrap / login），而登录页正是靠它浮出来的 —— 于是 App 里只有
   *   一处判断（`status === 'authenticated' ? 主界面 : guest ? 主界面 : 登录页`）。
   * ★ 播放本身**不依赖**它：播放器读的是本地文件与（有会话时的）后端，从不问「登没登录」。
   */
  guest: boolean
  client: ApiClient | null
  baseUrl: string | null
  serverName: string | null
  /**
   * 当前服务器上登录用的用户名。
   *
   * 后端没有「我是谁」接口（`/auth/login` 只回 token），所以只能登录时自己记，
   * 并跟着凭据按服务器隔离（见 StoredCredentials.username）。
   */
  username: string | null
  servers: ServerEntry[]
  backendVersion: string | null
  error: string | null
  busy: boolean
  /**
   * 当前 access token 的镜像。
   *
   * 真身在 ApiClient 里（那是唯一会刷新它的地方），这里只是把它挂到 store 上，
   * 好让**需要 token 拼 URL 的地方**（扩展页 webview）能在刷新后自动重建地址 ——
   * 只读 client.getAccessToken() 不会触发重渲染，扩展页会一直用着过期的 token。
   * 只在内存里，不落任何持久化存储。
   */
  accessToken: string
  /**
   * 迷你窗里那一份**资源上下文**（服务器地址 + token），由播放状态快照喂进来。
   *
   * ★ 为什么是喂而不是自己算：迷你窗刻意**不建会话**（不 bootstrap、不刷新令牌）——
   *   两个渲染层各持一个 ApiClient 的话，刷新令牌轮换时它们会互相把对方踢下线，
   *   而「莫名其妙要求重新登录」是最难查的一类故障。会话只有一个主人，就是主窗口。
   * ★ 主窗口里它一直是 null（那边有 client，resourceContext() 走真实路径）。
   */
  mirroredMedia: ResourceContext | null

  bootstrap: () => Promise<void>
  refreshServers: () => Promise<void>
  probe: (url: string) => Promise<ServerProbeResult>
  login: (url: string, username: string, password: string, serverName?: string) => Promise<void>
  logout: () => Promise<void>
  /**
   * 去登录页（侧栏那颗「连接服务器」、设置里的「切换账号」、退出登录都走它）。
   *
   * ★ 登录页现在是**一个目的地**，不是没登录时的默认落点 —— 默认落点是免登录的主界面。
   *   所以这一趟除 openLogin 之外没有别的入口，回主界面靠 closeLogin（登录页左上角那颗返回）。
   */
  openLogin: () => void
  /** 从登录页回主界面（那颗返回键、以及「来了本地文件」这条路都走它） */
  closeLogin: () => void
  /** 迷你窗专用：接收主窗口喂来的资源上下文（见 mirroredMedia 的说明） */
  setMirroredMedia: (media: ResourceContext | null) => void
  switchServer: (url: string) => Promise<void>
  forgetServer: (url: string) => Promise<void>
}

function createClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl, {
    onTokens: (tokens) => {
      const url = useAuth.getState().baseUrl
      // 镜像给 store：扩展页 URL 里带 token，刷新后得让它重建一次
      useAuth.setState({ accessToken: tokens?.accessToken ?? '' })
      if (url && tokens) {
        void window.songloft.credentials.set(url, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn
        })
      }
    },
    onAuthLost: () => {
      void window.songloft.credentials.clear(useAuth.getState().baseUrl ?? '')
      useAuth.setState({
        status: 'unauthenticated',
        error: '登录状态已失效，请重新登录',
        accessToken: ''
      })
    },
    onBaseResolved: (origin) => {
      // 302 后的真实地址变了。ApiClient 内部已经把媒体 URL 基准切到这个 origin
      // （getMediaBaseUrl），这里只做留痕：用户填的地址被重定向通常是代理配置问题，
      // 出问题时要能在 devtools 一眼看到真实落点。
      console.warn('[auth] 服务地址经重定向解析为', origin)
    }
  })
}

/** 用一次最便宜的认证请求确认 token 还能用 */
async function verifySession(client: ApiClient): Promise<boolean> {
  try {
    await getSongs(client, { limit: 1 })
    return true
  } catch (error) {
    if (error instanceof ApiError && error.isAuthError) return false
    // 网络问题不该把人踢下线，放行让用户自己看到主界面的错误
    return true
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'booting',
  // 免登录是**默认形态**：没会话时进的是主界面（见字段说明）。有会话时 bootstrap 会把它压回 false
  guest: true,
  client: null,
  baseUrl: null,
  serverName: null,
  username: null,
  servers: [],
  backendVersion: null,
  error: null,
  busy: false,
  accessToken: '',
  mirroredMedia: null,

  bootstrap: async () => {
    const servers = await window.songloft.servers.list()
    set({ servers })

    const { settings } = useSettings.getState()
    const activeUrl = settings.activeServerUrl ?? servers[0]?.url ?? null
    if (!activeUrl) {
      set({ status: 'unauthenticated' })
      return
    }

    const stored = await window.songloft.credentials.get(activeUrl)
    const client = createClient(activeUrl)
    set({
      client,
      baseUrl: activeUrl,
      serverName: servers.find((s) => s.url === activeUrl)?.name ?? null,
      username: stored?.username ?? null
    })

    if (!stored) {
      set({ status: 'unauthenticated' })
      return
    }

    client.setTokens({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresIn: stored.expiresIn
    })
    set({ accessToken: stored.accessToken })

    /*
     * ★ 下面两条「凭据失效」是**唯二**会把界面推向登录页的启动路径（把 guest 压成 false）：
     *   本机明明存着一份凭据、它却用不了了，用户需要知道这件事（原因就写在登录页那条错误里），
     *   也需要就地补一次密码。反过来说，「没有凭据」（上面那两条早退）与「网络不通」
     *   （verifySession 放行）都不该拦人 —— 前者正是免登录的默认形态，后者有会话在手。
     *   不想看这一页的人按左上角那颗返回即可，界面照旧是免登录的主界面。
     */
    // 本地推算已过期就先刷新，省掉一次注定 401 的请求
    const expired = stored.savedAt + stored.expiresIn * 1000 < Date.now() + 30_000
    if (expired && !(await client.refreshTokens())) {
      set({
        status: 'unauthenticated',
        guest: false,
        error: '登录状态已过期，请重新登录',
        accessToken: ''
      })
      return
    }

    if (!(await verifySession(client))) {
      set({ status: 'unauthenticated', guest: false, error: '登录状态已失效，请重新登录' })
      return
    }

    // 有会话就不必再待在免登录模式里（双击本地文件进来的那一趟可能比这里更早）
    set({ status: 'authenticated', guest: false, error: null })
    void get()
      .client!.request<{ version?: string }>('/version', { anonymous: true })
      .then((res) => set({ backendVersion: res.version ?? null }))
      .catch(() => undefined)
  },

  refreshServers: async () => {
    set({ servers: await window.songloft.servers.list() })
  },

  probe: (url) => window.songloft.servers.probe(url),

  login: async (url, username, password, serverName) => {
    set({ busy: true, error: null })
    const normalized = url.trim().replace(/\/+$/, '')
    try {
      // 先建一个匿名 client 完成登录，避免用旧 client 的 Authorization 干扰
      const client = createClient(normalized)
      const result = await loginRequest(client, username, password)
      const tokens: TokenPair = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresIn: result.expires_in
      }
      client.setTokens(tokens)

      const account = username.trim()
      // 用户名跟着凭据一起落盘：后端不回「我是谁」，下次启动只能靠它把账号名显示出来
      await window.songloft.credentials.set(normalized, { ...tokens, username: account })
      const servers = await window.songloft.servers.upsert({
        url: normalized,
        name: serverName?.trim() || new URL(normalized).host,
        lastUsedAt: Date.now()
      })
      await useSettings.getState().patch({ activeServerUrl: normalized })

      set({
        client,
        baseUrl: normalized,
        serverName: servers.find((s) => s.url === normalized)?.name ?? null,
        username: account,
        servers,
        guest: false,
        status: 'authenticated',
        busy: false,
        error: null,
        accessToken: tokens.accessToken
      })

      void client
        .request<{ version?: string }>('/version', { anonymous: true })
        .then((res) => set({ backendVersion: res.version ?? null }))
        .catch(() => undefined)
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.status === 401
            ? '用户名或密码不正确'
            : error.message
          : error instanceof Error
            ? error.message
            : '登录失败'
      set({ busy: false, error: message })
      // 带上 cause：调用方（登录页）只需要 message，但排查时要能追到原始的 ApiError
      throw new Error(message, { cause: error })
    }
  },

  logout: async () => {
    const { client, baseUrl } = get()
    if (client) {
      // 服务端吊销失败也无所谓：本地凭据一定要清干净
      await logoutRequest(client).catch(() => undefined)
    }
    if (baseUrl) await window.songloft.credentials.clear(baseUrl)
    client?.setTokens(null)
    /*
     * 退出登录是**明确要断开**：界面交还给登录页（guest: false），而不是就地落回免登录的主界面。
     * 想看本机文件的人按那颗返回即可 —— 那条路一直都在，只是不该是「退出」的默认落点。
     */
    set({ status: 'unauthenticated', guest: false, error: null, username: null, accessToken: '' })
  },

  openLogin: () => {
    // 刻意不清凭据、不吊销令牌：用户可能只是想换台服务器 / 换个账号，
    // 也可能只是点错了 —— 后者按返回（closeLogin）就回主界面，凭据原样还在。
    // 真正要抹掉本机凭据的是 logout。
    set({ status: 'unauthenticated', guest: false, error: null })
  },

  closeLogin: () => set({ guest: true, error: null }),

  setMirroredMedia: (mirroredMedia) => set({ mirroredMedia }),

  switchServer: async (url) => {
    set({ status: 'booting', error: null })
    const servers = get().servers
    const client = createClient(url)
    set({ client, baseUrl: url, serverName: servers.find((s) => s.url === url)?.name ?? null })

    const stored = await window.songloft.credentials.get(url)
    if (!stored) {
      set({ status: 'unauthenticated', username: null, accessToken: '' })
      return
    }
    client.setTokens({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresIn: stored.expiresIn
    })
    set({ accessToken: stored.accessToken })
    const expired = stored.savedAt + stored.expiresIn * 1000 < Date.now() + 30_000
    if (expired && !(await client.refreshTokens())) {
      set({ status: 'unauthenticated', error: '该服务器的登录已过期，请重新登录', accessToken: '' })
      return
    }
    if (!(await verifySession(client))) {
      set({ status: 'unauthenticated', error: '该服务器的登录已过期，请重新登录', accessToken: '' })
      return
    }
    await useSettings.getState().patch({ activeServerUrl: url })
    const fresh = await window.songloft.servers.upsert({
      url,
      name: servers.find((s) => s.url === url)?.name ?? new URL(url).host,
      lastUsedAt: Date.now()
    })
    set({
      status: 'authenticated',
      servers: fresh,
      username: stored.username ?? null,
      accessToken: client.getAccessToken()
    })
  },

  forgetServer: async (url) => {
    const servers = await window.songloft.servers.remove(url)
    const remaining = { servers }
    if (get().baseUrl === url) {
      const next = servers[0]?.url ?? null
      await useSettings.getState().patch({ activeServerUrl: next })
      set({ ...remaining, status: 'booting' })
      if (next) await get().switchServer(next)
      else
        set({
          status: 'unauthenticated',
          client: null,
          baseUrl: null,
          serverName: null,
          username: null,
          accessToken: ''
        })
      return
    }
    set(remaining)
  }
}))

/**
 * 给 lib/url.ts 用的资源上下文（服务器地址 + token）。
 *
 * ★ 有 client 就用 client 的（它是 token 刷新的唯一落点，读它拿到的永远是最新那一份）；
 *   没有 client 的窗口 —— 只有迷你窗 —— 用主窗口喂进来的那一份（见 mirroredMedia）。
 *   两条路都取不到时返回空，`buildResourceUrl` 会把地址拼成不带的 token 的样子
 *   （拿不到封面总好过抛错：迷你窗没有会话，这是它的正常状态之一）。
 */
export function resourceContext(): ResourceContext {
  const { client, baseUrl, mirroredMedia } = useAuth.getState()
  if (client && baseUrl) {
    return { baseUrl: client.getMediaBaseUrl(), accessToken: client.getAccessToken() }
  }
  return mirroredMedia ?? { baseUrl: '', accessToken: '' }
}

/** 必须在已登录时调用；拿不到 client 直接抛，避免一堆 `?.` 把真 bug 藏起来 */
export function requireClient(): ApiClient {
  const { client } = useAuth.getState()
  if (!client) throw new ApiError('尚未登录', 401, '', null)
  return client
}

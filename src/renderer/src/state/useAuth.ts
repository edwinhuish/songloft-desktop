/**
 * 会话与服务器。
 *
 * 三件事绑在一起管，因为它们互相决定：
 *   * ApiClient 实例（谁在发请求）
 *   * 凭据（谁是当前用户）—— 落主进程，按服务器 URL 隔离（walletKey 语义）
 *   * 媒体 URL 的基准地址（302 解析后的真实 origin）
 *
 * 启动流程刻意做成「先读磁盘 → 校验一次轻量认证请求 → 才进主界面」：
 * 直接把用户丢进主界面再弹一个「登录失效」是最难受的路径。
 */

import { create } from 'zustand'
import { ApiError, ApiClient, type TokenPair } from '@/api/client'
import { getSongs, login as loginRequest, logout as logoutRequest } from '@/api/endpoints'
import type { ServerEntry, ServerProbeResult } from '@shared/ipc'
import { useSettings } from './useSettings'

export type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated'

interface AuthState {
  status: AuthStatus
  client: ApiClient | null
  baseUrl: string | null
  serverName: string | null
  servers: ServerEntry[]
  backendVersion: string | null
  error: string | null
  busy: boolean

  bootstrap: () => Promise<void>
  refreshServers: () => Promise<void>
  probe: (url: string) => Promise<ServerProbeResult>
  login: (url: string, username: string, password: string, serverName?: string) => Promise<void>
  logout: () => Promise<void>
  switchServer: (url: string) => Promise<void>
  forgetServer: (url: string) => Promise<void>
}

function createClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl, {
    onTokens: (tokens) => {
      const url = useAuth.getState().baseUrl
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
      useAuth.setState({ status: 'unauthenticated', error: '登录状态已失效，请重新登录' })
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
  client: null,
  baseUrl: null,
  serverName: null,
  servers: [],
  backendVersion: null,
  error: null,
  busy: false,

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
    set({ client, baseUrl: activeUrl, serverName: servers.find((s) => s.url === activeUrl)?.name ?? null })

    if (!stored) {
      set({ status: 'unauthenticated' })
      return
    }

    client.setTokens({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresIn: stored.expiresIn
    })

    // 本地推算已过期就先刷新，省掉一次注定 401 的请求
    const expired = stored.savedAt + stored.expiresIn * 1000 < Date.now() + 30_000
    if (expired && !(await client.refreshTokens())) {
      set({ status: 'unauthenticated', error: '登录状态已过期，请重新登录' })
      return
    }

    if (!(await verifySession(client))) {
      set({ status: 'unauthenticated', error: '登录状态已失效，请重新登录' })
      return
    }

    set({ status: 'authenticated', error: null })
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

      await window.songloft.credentials.set(normalized, tokens)
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
        servers,
        status: 'authenticated',
        busy: false,
        error: null
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
    set({ status: 'unauthenticated', error: null })
  },

  switchServer: async (url) => {
    set({ status: 'booting', error: null })
    const servers = get().servers
    const client = createClient(url)
    set({ client, baseUrl: url, serverName: servers.find((s) => s.url === url)?.name ?? null })

    const stored = await window.songloft.credentials.get(url)
    if (!stored) {
      set({ status: 'unauthenticated' })
      return
    }
    client.setTokens({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresIn: stored.expiresIn
    })
    const expired = stored.savedAt + stored.expiresIn * 1000 < Date.now() + 30_000
    if (expired && !(await client.refreshTokens())) {
      set({ status: 'unauthenticated', error: '该服务器的登录已过期，请重新登录' })
      return
    }
    if (!(await verifySession(client))) {
      set({ status: 'unauthenticated', error: '该服务器的登录已过期，请重新登录' })
      return
    }
    await useSettings.getState().patch({ activeServerUrl: url })
    const fresh = await window.songloft.servers.upsert({
      url,
      name: servers.find((s) => s.url === url)?.name ?? new URL(url).host,
      lastUsedAt: Date.now()
    })
    set({ status: 'authenticated', servers: fresh })
  },

  forgetServer: async (url) => {
    const servers = await window.songloft.servers.remove(url)
    const remaining = { servers }
    if (get().baseUrl === url) {
      const next = servers[0]?.url ?? null
      await useSettings.getState().patch({ activeServerUrl: next })
      set({ ...remaining, status: 'booting' })
      if (next) await get().switchServer(next)
      else set({ status: 'unauthenticated', client: null, baseUrl: null, serverName: null })
      return
    }
    set(remaining)
  }
}))

/** 给 lib/url.ts 用的资源上下文（服务器地址 + token） */
export function resourceContext(): { baseUrl: string; accessToken: string } {
  const { client, baseUrl } = useAuth.getState()
  if (!client || !baseUrl) return { baseUrl: '', accessToken: '' }
  return { baseUrl: client.getMediaBaseUrl(), accessToken: client.getAccessToken() }
}

/** 必须在已登录时调用；拿不到 client 直接抛，避免一堆 `?.` 把真 bug 藏起来 */
export function requireClient(): ApiClient {
  const { client } = useAuth.getState()
  if (!client) throw new ApiError('尚未登录', 401, '', null)
  return client
}

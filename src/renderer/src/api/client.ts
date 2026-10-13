/**
 * HTTP 客户端。
 *
 * 只做三件事，但每件都必须做对：
 *   1. 统一的 query 序列化与错误包装（后端错误体是 `{error: "..."}`，直接抛字符串会丢信息）
 *   2. 401 → 单飞刷新 token → 重放原请求（并发 10 个请求同时 401 只刷新一次）
 *   3. 记录「302 重定向后的真实地址」—— 播放/封面 URL 由播放器内核直接请求，
 *      走不了这里的重定向，得拿真实地址去拼（songloft-org/songloft-player#22）。
 */

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export class ApiError extends Error {
  readonly status: number
  readonly path: string
  readonly payload: unknown

  constructor(message: string, status: number, path: string, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.payload = payload
  }

  /** 凭据问题（需要重新登录） */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  /** 网络层失败（服务没起来、DNS、超时……），status 为 0 */
  get isNetworkError(): boolean {
    return this.status === 0
  }
}

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  query?: Record<string, QueryValue>
  body?: unknown
  /** FormData 直接透传，不设 Content-Type（要让浏览器自己带 boundary） */
  formData?: FormData
  signal?: AbortSignal
  /** 跳过认证与刷新逻辑（登录、探测等） */
  anonymous?: boolean
}

/** XHR 回来的东西。fetch 那份 Response 没法在回调里留住，所以只取这两样 */
interface XhrResult {
  status: number
  text: string
}

const API_PREFIX = '/api/v1'

function serializeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

/** 从后端错误体里挖出一句能给人看的话 */
function extractMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) return payload
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['error', 'message', 'msg', 'detail']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return '没有权限执行该操作'
  if (status === 404) return '接口不存在（可能是后端版本过旧）'
  if (status >= 500) return `服务端错误（HTTP ${status}）`
  return `请求失败（HTTP ${status}）`
}

export interface ApiClientHooks {
  onTokens: (tokens: TokenPair | null) => void
  onAuthLost: () => void
  onBaseResolved?: (origin: string) => void
}

export class ApiClient {
  private baseUrl: string
  private tokens: TokenPair | null = null
  private readonly hooks: ApiClientHooks
  private refreshInFlight: Promise<boolean> | null = null
  /** 302 解析后的真实 origin；未解析时为空 */
  private resolvedOrigin: string | null = null

  constructor(baseUrl: string, hooks: ApiClientHooks) {
    this.baseUrl = baseUrl
    this.hooks = hooks
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl
    this.resolvedOrigin = null
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setTokens(tokens: TokenPair | null): void {
    this.tokens = tokens
  }

  getAccessToken(): string {
    return this.tokens?.accessToken ?? ''
  }

  /**
   * 拼媒体 URL 用的地址：优先用 302 解析出的真实 origin。
   * 播放/封面请求由内核直接发出，跨 host 的 302 不保证保留 query，
   * 所以必须拿真实地址直接连（见类注释）。
   */
  getMediaBaseUrl(): string {
    return this.resolvedOrigin ?? this.baseUrl
  }

  private noteResolved(url: string): void {
    try {
      const origin = new URL(url).origin
      const configured = new URL(this.baseUrl).origin
      if (origin !== configured && origin !== 'null') {
        if (this.resolvedOrigin !== origin) {
          this.resolvedOrigin = origin
          this.hooks.onBaseResolved?.(origin)
        }
      }
    } catch {
      /* url 解析失败就忽略，不值得让一次成功的请求因此失败 */
    }
  }

  /**
   * 带上传进度的表单提交（走 XHR，不走 fetch）。
   *
   * ★ 为什么单开一条而不是塞进 request：fetch 没有上传进度事件，而升级包动辄几十上百兆 ——
   *   一个不动的「上传中…」跟卡死没有区别。XHR 的 upload.onprogress 是唯一能拿到进度的路径。
   *   顺带：FormData 交给浏览器序列化，multipart 的 boundary 与 Content-Type 都不用我们碰。
   */
  upload<T>(
    path: string,
    formData: FormData,
    onProgress?: (sent: number, total: number) => void
  ): Promise<T> {
    const send = (): Promise<XhrResult> => this.sendUpload(path, formData, onProgress)
    return send().then(async (result) => {
      if (result.status === 401 && (await this.refreshTokens())) {
        return this.unwrapXhr<T>(await send(), path)
      }
      return this.unwrapXhr<T>(result, path)
    })
  }

  private sendUpload(
    path: string,
    formData: FormData,
    onProgress?: (sent: number, total: number) => void
  ): Promise<XhrResult> {
    return new Promise<XhrResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${this.baseUrl}${API_PREFIX}${path}`)
      xhr.setRequestHeader('Accept', 'application/json')
      if (this.tokens?.accessToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${this.tokens.accessToken}`)
      }
      xhr.upload.onprogress = (event) => {
        // 服务端返回压缩响应时拿不到总长度，那时宁可不报百分比，也别报个错的比例
        if (event.lengthComputable) onProgress?.(event.loaded, event.total)
      }
      xhr.onload = () => {
        this.noteResolved(xhr.responseURL || '')
        resolve({ status: xhr.status, text: xhr.responseText })
      }
      xhr.onerror = () => reject(new ApiError('上传失败：连接中断', 0, path, null))
      xhr.onabort = () => reject(new ApiError('上传已取消', 0, path, null))
      xhr.send(formData)
    })
  }

  private unwrapXhr<T>(result: XhrResult, path: string): T {
    return this.parseBody<T>(result.status, result.text, path)
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.rawRequest(path, options)

    if (response.status === 401 && !options.anonymous) {
      const refreshed = await this.refreshTokens()
      if (refreshed) {
        const retried = await this.rawRequest(path, options)
        return this.unwrap<T>(retried, path)
      }
      this.hooks.onAuthLost()
    }

    return this.unwrap<T>(response, path)
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const url = `${this.baseUrl}${API_PREFIX}${path}${serializeQuery(options.query)}`
    const headers: Record<string, string> = { Accept: 'application/json' }

    if (!options.anonymous && this.tokens?.accessToken) {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`
    }

    let body: BodyInit | undefined
    if (options.formData) {
      body = options.formData
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: options.signal
      })
      this.noteResolved(response.url || url)
      return response
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message =
        error instanceof TypeError
          ? '无法连接到服务器，请检查地址、服务是否在运行，以及网络是否可达'
          : error instanceof Error
            ? error.message
            : String(error)
      throw new ApiError(message, 0, path, null)
    }
  }

  private async unwrap<T>(response: Response, path: string): Promise<T> {
    return this.parseBody<T>(response.status, await response.text(), path)
  }

  /** 「状态码 + 响应体文本」→ 结果或 ApiError。fetch 与 XHR 两条路共用同一套解包 */
  private parseBody<T>(status: number, text: string, path: string): T {
    if (status === 204) return undefined as T

    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        payload = text
      }
    }

    if (status < 200 || status >= 300) {
      throw new ApiError(extractMessage(payload, status), status, path, payload)
    }

    return payload as T
  }

  /** 单飞刷新：并发 401 只触发一次网络请求 */
  async refreshTokens(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight

    const refreshToken = this.tokens?.refreshToken
    if (!refreshToken) return false

    this.refreshInFlight = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken })
        })
        if (!response.ok) return false
        const data = (await response.json()) as {
          access_token: string
          refresh_token: string
          expires_in: number
        }
        const next: TokenPair = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in
        }
        this.tokens = next
        this.hooks.onTokens(next)
        return true
      } catch {
        return false
      } finally {
        this.refreshInFlight = null
      }
    })()

    return this.refreshInFlight
  }
}

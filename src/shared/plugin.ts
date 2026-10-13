/**
 * JS 插件（扩展）的数据模型与排序规则。
 *
 * 插件本体装在**后端**（QuickJS 沙箱 + 磁盘目录），桌面端只是遥控器：列表 / 安装 /
 * 启用 / 卸载都走 HTTP，本地不存插件二进制。本地只存两样轻量配置 —— 谁出现在标题栏、
 * 谁排在前面。
 *
 * 与 shared/lyric.ts 同规格：纯代码、无副作用、不 import electron。所以两侧都能用，
 * 也能直接单测（见 plugin.test.ts）。
 */

/**
 * 后端 `status` 三态。
 *
 * `error` 不是「插件坏了」，而是「后端正在指数退避自愈」—— 界面不该把它当失败处理，
 * 但按上游语义它确实不出现在入口位上（见 isDisplayable）。
 */
export type PluginStatus = 'active' | 'inactive' | 'error'

/**
 * 扩展页专用的 session partition。
 *
 * ★ 必须**独立于 defaultSession**。主进程会给 defaultSession 挂
 *   `webRequest.onHeadersReceived` 注入应用自己的 CSP（那是**改写整个会话**的），
 *   而扩展页的 HTML 也是从这台服务器上取回来的 —— 不隔离的话，插件页会被套上
 *   `script-src 'self'` 这类宿主限制，表现是插件莫名其妙地坏掉，且没有任何报错。
 *
 * `persist:` 前缀让它落盘：插件页靠 localStorage 记住后端注入的 access_token，
 * 内存会话会在窗口重开时把它丢掉。
 */
export const PLUGIN_PARTITION = 'persist:songloft-extensions'

/**
 * 后端 `GET /api/v1/jsplugins` 里单条插件的原始形状。
 *
 * 字段名是 snake_case，与 models.JSPlugin 的 json tag 一一对应。刻意留着这份「线格式」
 * 类型：转换集中在一个函数里，字段名只在这里出现一次，将来后端加字段不会散落到各处。
 */
export interface PluginWire {
  id?: number | string | null
  name?: string | null
  version?: string | null
  description?: string | null
  author?: string | null
  homepage?: string | null
  license?: string | null
  entry_path?: string | null
  main?: string | null
  min_host_version?: string | null
  permissions?: string[] | null
  icon?: string | null
  update_url?: string | null
  download_url?: string | null
  render_engine?: string | null
  status?: string | null
  zip_hash?: string | null
  entry_hash?: string | null
  file_path?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** 渲染层使用的插件模型（camelCase） */
export interface JSPlugin {
  id: number
  name: string
  version: string
  description: string
  author: string
  homepage: string
  license: string
  /** 路由前缀，如 `myplugin`。排序键就是它（不是 id） */
  entryPath: string
  main: string
  minHostVersion: string
  permissions: string[]
  /**
   * 相对插件 `static/` 目录的图标文件名。
   *
   * 后端在返回列表时已经把 manifest 里声明的名字解析成**磁盘上真实存在**的那个
   * （带 content hash 指纹的也认），所以这里拿到的是可直接拼 URL 的名字；空串表示没有。
   *
   * ★ 只有**列表 / 详情**（`GET /jsplugins`、`GET /jsplugins/{id}`）保证是解析过的：
   *   启用 / 停用（以及更新）的响应里是数据库里那份**原始**值。改动插件对象时别拿它
   *   覆盖本机这份，否则图标会退回兜底图 —— 收口处见 `state/usePlugins.setEnabled`。
   */
  icon: string
  updateUrl: string
  downloadUrl: string
  /** 渲染引擎：`webview` / `lynx` / 空串（跟随宿主默认） */
  renderEngine: string
  status: PluginStatus
  filePath: string
  createdAt: string
  updatedAt: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStatus(value: unknown): PluginStatus {
  return value === 'active' || value === 'error' ? value : 'inactive'
}

function toId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 线格式 → 渲染层模型。所有「可能缺字段」的处理只在这里做一次 */
export function toPlugin(wire: PluginWire): JSPlugin {
  return {
    id: toId(wire.id),
    name: text(wire.name),
    version: text(wire.version),
    description: text(wire.description),
    author: text(wire.author),
    homepage: text(wire.homepage),
    license: text(wire.license),
    entryPath: text(wire.entry_path),
    main: text(wire.main),
    minHostVersion: text(wire.min_host_version),
    permissions: Array.isArray(wire.permissions) ? wire.permissions.filter(Boolean) : [],
    icon: text(wire.icon),
    updateUrl: text(wire.update_url),
    downloadUrl: text(wire.download_url),
    renderEngine: text(wire.render_engine),
    status: toStatus(wire.status),
    filePath: text(wire.file_path),
    createdAt: text(wire.created_at),
    updatedAt: text(wire.updated_at)
  }
}

/** 列表接口可能整体缺 `plugins`，统一在这里兜底，调用方不必写 `?? []` */
export function toPluginList(wires: PluginWire[] | null | undefined): JSPlugin[] {
  return (wires ?? []).map(toPlugin)
}

/** 展示名。后端允许 name 为空，这时退回 entryPath，再不行才是 id */
export function pluginDisplayName(plugin: JSPlugin): string {
  return plugin.name || plugin.entryPath || `插件 #${plugin.id}`
}

/**
 * 是否出现在扩展入口位上。
 *
 * 与上游 ActiveDestinations.compute 的过滤条件一致：**启用**且**有 entryPath**。
 * 停用与 error 都不出现（停用是用户的选择；error 是后端正在自愈，此时入口点进去
 * 也是 503）。它们仍然留在扩展管理页里，用户能看见并处理。
 */
export function isDisplayable(plugin: JSPlugin): boolean {
  return plugin.status === 'active' && plugin.entryPath.length > 0
}

/**
 * 按持久化的 entryPath 顺序重排。
 *
 * 四条语义照搬上游 plugin_order.dart（后端 `plugin_order` 存的正是这份列表）：
 *   1. `order` 为空 → 原样返回（等价于沿用后端给出的默认顺序）；
 *   2. 排序键是 **entryPath**，不是 id；
 *   3. `order` 里已不存在的 entryPath 跳过（卸载竞态兜底），重复的只取首个匹配；
 *   4. 未列入 `order` 的插件按原相对顺序追加到末尾 —— **新装插件默认落尾**。
 *
 * 返回新数组、不改入参：它是给 React 当派生值用的，原地排序会让 memo 失效。
 */
export function applyPluginOrder(plugins: JSPlugin[], order: string[]): JSPlugin[] {
  if (order.length === 0) return [...plugins]

  const byEntry = new Map<string, JSPlugin>()
  for (const plugin of plugins) {
    if (!plugin.entryPath) continue
    if (!byEntry.has(plugin.entryPath)) byEntry.set(plugin.entryPath, plugin)
  }

  const result: JSPlugin[] = []
  const used = new Set<string>()
  for (const entry of order) {
    if (used.has(entry)) continue
    const plugin = byEntry.get(entry)
    if (!plugin) continue
    result.push(plugin)
    used.add(entry)
  }

  for (const plugin of plugins) {
    if (!plugin.entryPath || used.has(plugin.entryPath)) continue
    result.push(plugin)
    used.add(plugin.entryPath)
  }

  return result
}

/** 把一份插件列表收敛成排序用的 entryPath 序列（写回 plugin-order 时用） */
export function entryPathsOf(plugins: JSPlugin[]): string[] {
  return plugins.map((plugin) => plugin.entryPath).filter(Boolean)
}

/** 图标在后端上的相对路径（相对服务器根）。静态路由无需认证，故不带 token */
export function pluginIconPath(plugin: JSPlugin): string {
  if (!plugin.icon || !plugin.entryPath) return ''
  return `/api/v1/jsplugin/${plugin.entryPath}/static/${plugin.icon}`
}

/**
 * 没有图标时按名字派生的兜底色相（0–359）。
 *
 * 用名字而不是 id：卸载重装、或者两台设备上同一个插件，颜色应当一致。
 */
export function pluginFallbackHue(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return hash
}

export interface PluginPageContext {
  /** 服务器地址，不带 `/api/v1` */
  baseUrl: string
  accessToken: string
  theme?: 'dark' | 'light'
  /**
   * 告诉插件页「你是被嵌在宿主里的」。
   *
   * 默认开：后端注入的 SDK 据此调整布局（隐藏自己的标题栏等）。这是它唯一能分辨
   * 「独立打开」与「嵌在播放器里」的途径 —— 两种形态的 URL 其余部分完全相同。
   */
  embed?: boolean
}

/**
 * 插件页地址，交给 `<webview>` 装载。
 *
 * token 走查询参数：webview 的初次导航发不了自定义头（与封面/音频同一套限制）。
 * 后端注入的 auth-bridge 会把它写进 localStorage 并顺手清掉 URL 里的痕迹。
 */
export function pluginPageUrl(plugin: JSPlugin, ctx: PluginPageContext): string {
  if (!plugin.entryPath) return ''
  const base = ctx.baseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams()
  if (ctx.accessToken) params.set('access_token', ctx.accessToken)
  if (ctx.theme) params.set('theme', ctx.theme)
  if (ctx.embed !== false) params.set('embed', '1')
  const query = params.toString()
  return `${base}/api/v1/jsplugin/${plugin.entryPath}${query ? `?${query}` : ''}`
}

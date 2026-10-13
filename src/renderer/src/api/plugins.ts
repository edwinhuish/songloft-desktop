/**
 * JS 插件（扩展）的后端调用点。
 *
 * 端点来自 songloft 服务端 `internal/handlers/jsplugin.go`、`jsplugin_registry.go` 与
 * `internal/app/routers.go` 里 `/settings/plugin-registries` 那两条。这里只做两件事：
 * 拼路径、把线格式（snake_case）收成渲染层用得顺手的模型。业务判断（谁能装、能不能更新、
 * 某个源是公开还是私有）一律依赖后端 —— 版本比较与身份判定的规则都在后端，自己算必然漂移。
 */

import { toPlugin, toPluginList, type JSPlugin, type PluginWire } from '@shared/plugin'
import type { ApiClient } from './client'

/* ─────────────────────────── 已安装的插件 ─────────────────────────── */

export function listPlugins(client: ApiClient): Promise<JSPlugin[]> {
  return client
    .request<{ plugins?: PluginWire[] }>('/jsplugins')
    .then((res) => toPluginList(res.plugins))
}

/**
 * 启用 / 停用一个插件。
 *
 * 后端返回更新后的插件本体，直接用它替换本地那一条 —— 比「改完再重拉整份列表」少一次
 * 请求，也避免两次请求之间列表闪一下。
 */
export function setPluginEnabled(
  client: ApiClient,
  id: number,
  enabled: boolean
): Promise<JSPlugin> {
  const action = enabled ? 'enable' : 'disable'
  return client
    .request<{ plugin: PluginWire }>(`/jsplugins/${id}/${action}`, { method: 'POST' })
    .then((res) => toPlugin(res.plugin))
}

/**
 * 卸载插件。
 *
 * 不带 `keep_data`：后端默认连插件的磁盘数据目录一起清掉，并顺手把 `plugin_order` /
 * `tab_config` 里的孤儿条目也清干净（见 handleDelete）。带 keep_data 会留下数据目录，
 * 那是「重装后想继承数据」的高级用法，界面暂不提供。
 */
export function deletePlugin(client: ApiClient, id: number): Promise<void> {
  return client.request<void>(`/jsplugins/${id}`, { method: 'DELETE' })
}

/** 上传结果里的单条（后端 jsPluginUploadResult，字段名与上游 Flutter 对齐） */
export interface PluginUploadResult {
  fileName: string
  plugin: JSPlugin | null
  error: string
  success: boolean
}

export interface PluginUploadResponse {
  total: number
  success: number
  failed: number
  results: PluginUploadResult[]
  message: string
}

interface PluginUploadWire {
  total?: number
  success?: number
  failed?: number
  results?: {
    file_name?: string
    plugin?: PluginWire
    error?: string
    success?: boolean
  }[]
  message?: string
}

function toUploadResponse(res: PluginUploadWire): PluginUploadResponse {
  const results = (res.results ?? []).map((item) => ({
    fileName: item.file_name ?? '',
    plugin: item.plugin ? toPlugin(item.plugin) : null,
    error: item.error ?? '',
    success: Boolean(item.success)
  }))
  return {
    total: res.total ?? results.length,
    success: res.success ?? results.filter((item) => item.success).length,
    failed: res.failed ?? results.filter((item) => !item.success).length,
    results,
    message: res.message ?? ''
  }
}

/**
 * 上传本地 `.jsplugin.zip` 安装。
 *
 * 走 XHR（`ApiClient.upload`）而不是 fetch：插件包虽小，但同一个方法能带上传进度，
 * 且它内部已经处理了 401 刷新重放。后端把「安装失败」也放在 200 的 body 里
 * （`success: 0`），所以**要看 results 而不是看有没有抛异常**。
 */
export function uploadPlugin(
  client: ApiClient,
  file: File,
  onProgress?: (sent: number, total: number) => void
): Promise<PluginUploadResponse> {
  const form = new FormData()
  // 字段名必须是 file：后端按 multipart 的 file 字段取
  form.append('file', file, file.name)
  return client
    .upload<PluginUploadWire>('/jsplugins/upload', form, onProgress)
    .then(toUploadResponse)
}

/* ─────────────────────────── 批量更新 / 清理 ─────────────────────────── */

/** 批量更新里的一条（后端 jsPluginBatchUpdateResult） */
export interface PluginBatchUpdateItem {
  pluginId: number
  pluginName: string
  entryPath: string
  success: boolean
  /** 这一条确实被检查出有新版本（false 且 success=false 的那些是「没更新源」或「已最新」） */
  hasUpdate: boolean
  currentVersion: string
  newVersion: string
  error: string
}

export interface PluginBatchUpdate {
  total: number
  updated: number
  failed: number
  /** 没有远程更新源、或已经是最新版的那些。**不是失败**，见 updateAllPlugins */
  skipped: number
  message: string
  results: PluginBatchUpdateItem[]
}

interface PluginBatchUpdateWire {
  total?: number
  updated?: number
  failed?: number
  skipped?: number
  message?: string
  results?: {
    plugin_id?: number
    plugin_name?: string
    entry_path?: string
    success?: boolean
    has_update?: boolean
    current_version?: string
    new_version?: string
    error?: string
  }[]
}

/**
 * 批量更新所有插件（`POST /jsplugins/update-all`）。
 *
 * ★ 它更新的是**声明了远程更新源**（manifest 里的 `updateUrl`）的插件 —— 后端对没有更新源
 *   的插件直接计入 `skipped`（见 auto_update.go 的 RunUpdateAll）。所以「跳过 N 个」不是
 *   失败，而是那些插件没有任何可查的远端版本，想升级只能到商店里逐个装。
 *
 * `force` 会跳过「已是最新版」的判断强制重装；常规点击不要传它。
 */
export function updateAllPlugins(
  client: ApiClient,
  options: { githubProxy?: string; force?: boolean } = {}
): Promise<PluginBatchUpdate> {
  return client
    .request<PluginBatchUpdateWire>('/jsplugins/update-all', {
      method: 'POST',
      body: { github_proxy: options.githubProxy ?? '', force: options.force ?? false }
    })
    .then((res) => ({
      total: res.total ?? 0,
      updated: res.updated ?? 0,
      failed: res.failed ?? 0,
      skipped: res.skipped ?? 0,
      message: res.message ?? '',
      results: (res.results ?? []).map((item) => ({
        pluginId: item.plugin_id ?? 0,
        pluginName: item.plugin_name ?? '',
        entryPath: item.entry_path ?? '',
        success: Boolean(item.success),
        hasUpdate: Boolean(item.has_update),
        currentVersion: item.current_version ?? '',
        newVersion: item.new_version ?? '',
        error: item.error ?? ''
      }))
    }))
}

export interface PluginStorageCleanup {
  message: string
  /** 清掉了几个插件的孤儿数据（0 = 本来就没有残留） */
  cleaned: number
}

/**
 * 清理已卸载插件的残留数据（`POST /jsplugins/storage/cleanup`）。
 *
 * 清的是 `plugin_storage` 里没有对应已安装插件的那些行（卸载时若带了 keep_data 就会留下）。
 * **不可恢复** —— 调用方必须先让用户确认。
 */
export function cleanupPluginStorage(client: ApiClient): Promise<PluginStorageCleanup> {
  return client
    .request<{ message?: string; cleaned?: number }>('/jsplugins/storage/cleanup', {
      method: 'POST'
    })
    .then((res) => ({ message: res.message ?? '', cleaned: res.cleaned ?? 0 }))
}

/* ─────────────────────────── 订阅源 ─────────────────────────── */

/**
 * 一个扩展订阅源。
 *
 * ★ 没有 id、也没有类型字段：**URL 就是身份** —— 后端按 URL 匹配条目来源、解析它自己的
 *   token（`resolveSourceToken`），所以「改地址」在语义上等于「删掉旧的再加一个」。
 *   `token` 非空即私有源：该源的条目下载时改走 `Authorization: Bearer`。
 */
export interface RegistrySource {
  url: string
  name: string
  enabled: boolean
  token: string
}

interface RegistrySourceWire {
  url?: string
  name?: string
  enabled?: boolean
  token?: string
}

function toRegistrySource(wire: RegistrySourceWire): RegistrySource {
  return {
    // enabled 缺字段时按「启用」算：默认官方源就是启用的，把它当成停用会让人以为源没了
    url: wire.url ?? '',
    name: wire.name ?? '',
    enabled: wire.enabled !== false,
    token: wire.token ?? ''
  }
}

/** 读取订阅源列表。**未配置时后端返回内置的官方源**，不是空列表 */
export function getPluginRegistries(client: ApiClient): Promise<RegistrySource[]> {
  return client
    .request<{ registries?: RegistrySourceWire[] }>('/settings/plugin-registries')
    .then((res) => (res.registries ?? []).map(toRegistrySource))
}

/**
 * 整表覆盖保存。
 *
 * 后端只有这一个写入口（没有单条增删改端点），所以：删一个源 = 保存时不带它、
 * 停用 = 带上 `enabled: false`、排序 = 调数组顺序。返回值以服务端为准。
 */
export function updatePluginRegistries(
  client: ApiClient,
  registries: RegistrySource[]
): Promise<RegistrySource[]> {
  return client
    .request<{ registries?: RegistrySourceWire[] }>('/settings/plugin-registries', {
      method: 'PUT',
      body: {
        registries: registries.map((source) => ({
          url: source.url,
          name: source.name,
          enabled: source.enabled,
          token: source.token
        }))
      }
    })
    .then((res) => (res.registries ?? []).map(toRegistrySource))
}

/* ─────────────────────────── 排序（plugin-order）─────────────────────────── */

/**
 * 扩展的显示顺序。
 *
 * 元素是 `entryPath` 而非 id：后端保存时按它清理孤儿条目，且卸载重装后顺序能自动恢复。
 * 已装插件里不出现在这份列表的，由 applyPluginOrder 追加到末尾。
 */
export function getPluginOrder(client: ApiClient): Promise<string[]> {
  return client
    .request<{ order?: string[] }>('/settings/plugin-order')
    .then((res) => res.order ?? [])
}

/**
 * 保存顺序。**以服务端返回为准**：它会在保存时静默剔除已卸载插件的条目，
 * 前端如果沿用自己那份，界面就会显示一个并不存在的插件。
 */
export function updatePluginOrder(client: ApiClient, order: string[]): Promise<string[]> {
  return client
    .request<{ order?: string[] }>('/settings/plugin-order', { method: 'PUT', body: { order } })
    .then((res) => res.order ?? [])
}

/* ─────────────────────────── 插件商店 ─────────────────────────── */

/** 商店里的一条（后端 registryPluginEntry） */
export interface RegistryEntry {
  name: string
  entryPath: string
  version: string
  description: string
  author: string
  homepage: string
  icon: string
  downloadUrl: string
  installed: boolean
  installedVersion: string
  /** 已装且商店版本更高 */
  hasUpdate: boolean
  /** 该条所属订阅源（仅聚合模式返回），安装时回传给后端以解析私有源 token */
  sourceUrl: string
  sourceName: string
  /** entryPath 之外的身份维度，用于区分撞名的两个插件 */
  identity: string
  /** 本地的同 entryPath 被**另一个作者**的插件占用（此时 installed 为 false） */
  conflict: boolean
  /** 占用者的可读描述，直接展示给用户 */
  conflictWith: string
}

export interface RegistryPage {
  plugins: RegistryEntry[]
  total: number
  page: number
  pageSize: number
  warnings: string[]
}

interface RegistryEntryWire {
  name?: string
  entry_path?: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  icon?: string
  download_url?: string
  installed?: boolean
  installed_version?: string
  has_update?: boolean
  source_url?: string
  source_name?: string
  identity?: string
  conflict?: boolean
  conflict_with?: string
}

/**
 * 列表行的稳定标识。
 *
 * 只按 entryPath 不够：同一 entryPath 可能被不同作者的插件各占一行（后端按
 * entry_path + identity 去重），只用 entryPath 做 key 会让两行互相顶掉。
 */
export function registryRowKey(entry: RegistryEntry): string {
  return `${entry.entryPath}::${entry.identity}`
}

export interface RegistryQuery {
  /**
   * 只看这一个订阅源（源 URL）。不传 = 聚合所有**已启用**的源。
   *
   * ★ 后端单源模式的参数名是 `registry_url`（`source_url` 是**响应**里回传来源用的，不是请求参数）。
   *   单源模式下后端不去读已保存的配置，私有源的 token 必须由调用方一起带上。
   */
  sourceUrl?: string
  /** 单源模式下的私有源 token（与 sourceUrl 配对；公开源留空） */
  sourceToken?: string
  page?: number
  pageSize?: number
  search?: string
  /** 越过服务端 5 分钟缓存强制重拉。只给「刷新」按钮，翻页/搜索不要传 */
  force?: boolean
  /** 后端不会自己去读它存的那份配置，必须显式带 */
  githubProxy?: string
}

export function refreshRegistry(
  client: ApiClient,
  query: RegistryQuery = {}
): Promise<RegistryPage> {
  return client
    .request<{
      plugins?: RegistryEntryWire[]
      total?: number
      page?: number
      page_size?: number
      warnings?: string[]
    }>('/jsplugins/registry/refresh', {
      method: 'POST',
      body: {
        all_sources: !query.sourceUrl,
        registry_url: query.sourceUrl ?? '',
        token: query.sourceToken ?? '',
        page: query.page ?? 1,
        page_size: query.pageSize ?? 20,
        search: query.search ?? '',
        force: query.force ?? false,
        github_proxy: query.githubProxy ?? ''
      }
    })
    .then((res) => ({
      plugins: (res.plugins ?? []).map((item) => ({
        name: item.name ?? '',
        entryPath: item.entry_path ?? '',
        version: item.version ?? '',
        description: item.description ?? '',
        author: item.author ?? '',
        homepage: item.homepage ?? '',
        icon: item.icon ?? '',
        downloadUrl: item.download_url ?? '',
        installed: Boolean(item.installed),
        installedVersion: item.installed_version ?? '',
        hasUpdate: Boolean(item.has_update),
        sourceUrl: item.source_url ?? '',
        sourceName: item.source_name ?? '',
        identity: item.identity ?? '',
        conflict: Boolean(item.conflict),
        conflictWith: item.conflict_with ?? ''
      })),
      total: res.total ?? 0,
      page: res.page ?? 1,
      pageSize: res.page_size ?? 20,
      warnings: res.warnings ?? []
    }))
}

export interface RegistryInstallParams {
  downloadUrl: string
  /**
   * 条目来自哪个源，供后端**按 URL 查出该源的 token**（单源筛选模式下商店条目不带
   * source_url，那时用当前筛选的那个源）。
   */
  sourceUrl?: string
  githubProxy?: string
  /** 覆盖掉占用同 entryPath 但作者不同的插件（必须先弹冲突确认） */
  overwrite?: boolean
}

/**
 * 从商店安装。
 *
 * ★ 同 entryPath 被另一个作者的插件占用时后端返回 **409** 且不做任何写入 ——
 * 调用方要接住这个状态码，向用户说明「会替换掉本地那个插件」后再带 `overwrite: true`
 * 重发。`installed / has_update` 的那些正常路径返回 200/201。
 */
export function installFromRegistry(
  client: ApiClient,
  params: RegistryInstallParams
): Promise<PluginUploadResponse> {
  return client
    .request<PluginUploadWire>('/jsplugins/registry/install', {
      method: 'POST',
      body: {
        download_url: params.downloadUrl,
        source_url: params.sourceUrl ?? '',
        github_proxy: params.githubProxy ?? '',
        overwrite: params.overwrite ?? false
      }
    })
    .then(toUploadResponse)
}

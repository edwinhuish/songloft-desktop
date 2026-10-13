/**
 * 已安装的扩展（JS 插件）与其显示顺序。
 *
 * 这个 store 是**唯一**的插件事实源：扩展侧栏、插件商店、插件管理页全部从这里派生。
 * 三处各自维护一份「我拿到的插件列表」是这类功能最常见的坏法 —— 装一个插件后有的地方
 * 刷新了、有的地方没刷新，看起来像随机丢按钮。
 *
 * 顺序采用「乐观提交 → 以服务端返回为准 → 失败回滚」：后端会在保存时静默剔除已卸载
 * 插件的条目，前端如果沿用自己那份，界面就会显示一个并不存在的插件。
 */

import { useMemo } from 'react'
import { create } from 'zustand'

import { applyPluginOrder, entryPathsOf, isDisplayable, type JSPlugin } from '@shared/plugin'
import {
  deletePlugin,
  getPluginOrder,
  listPlugins,
  setPluginEnabled,
  updatePluginOrder
} from '@/api/plugins'
import { requireClient } from './useAuth'

/**
 * 单个扩展的**运行时**音频状态。
 *
 * 刻意与插件列表分开：它来自 webview 的事件，随播放起停高频变化；混进插件列表会让
 * 每次播放/暂停都触发一遍列表重排与全部入口按钮重渲染。后端对这两样一无所知。
 */
export interface ExtensionRuntime {
  /** 该扩展正在出声 */
  playing: boolean
  /** 用户对它静音了（由 PluginSurface 落到 webview.setAudioMuted） */
  muted: boolean
}

const IDLE_RUNTIME: ExtensionRuntime = { playing: false, muted: false }

/**
 * 每个插件**最近一次**启停意图的序号。
 *
 * 停用要走 scheduler 注销，最坏能拖到 10 秒（服务端 UnloadPlugin 里 UnregisterService
 * 的超时），期间用户完全可能改主意再点一次 —— 两次请求的响应于是可能**乱序**回来：
 * 后发的先到、先发的后到，界面就会被那份过期的响应翻回去 (而开关明明是手刚点过的样子)。
 * 只认「仍是最新那次」的响应，这条时序问题就挡在 store 里了。
 *
 * 放模块作用域而不是 state：它是实现细节，界面不该读到它。
 */
const toggleSeq = new Map<number, number>()

interface PluginsState {
  plugins: JSPlugin[]
  /** 用户排出来的 entryPath 序列（可能包含已卸载的残留，排序时会被跳过） */
  order: string[]
  runtime: Record<string, ExtensionRuntime>
  loaded: boolean
  loading: boolean
  error: string | null

  load: () => Promise<void>
  /** 用一份完整顺序覆盖（插件管理页拖拽排序走它） */
  setOrder: (order: string[]) => Promise<void>
  /**
   * 启用 / 停用。**乐观**：界面立刻跟着意图翻，不成功后端往返；失败则整条回退成操作前
   * 那一个并把错误**抛给调用方**（提示是界面的事，store 不弹 toast）。
   */
  setEnabled: (id: number, enabled: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
  /** webview 事件回写 */
  setRuntime: (entryPath: string, patch: Partial<ExtensionRuntime>) => void
  toggleMuted: (entryPath: string) => void
  clearRuntime: (entryPath: string) => void
  reset: () => void
}

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  order: [],
  runtime: {},
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    const client = requireClient()
    set({ loading: true })
    try {
      // 两个请求互不依赖，并行发；任一失败都当作整体失败（少一个都会让界面不自洽）
      const [plugins, order] = await Promise.all([listPlugins(client), getPluginOrder(client)])
      set({ plugins, order, loaded: true, loading: false, error: null })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '扩展列表加载失败'
      })
      throw error
    }
  },

  setOrder: async (order) => {
    const client = requireClient()
    const previous = get().order
    set({ order }) // 乐观：拖完立刻看到结果
    try {
      const saved = await updatePluginOrder(client, order)
      set({ order: saved })
    } catch (error) {
      set({ order: previous })
      throw error
    }
  },

  setEnabled: async (id, enabled) => {
    const client = requireClient()
    // 操作前那一条整份快照：失败时回退成它（而不是「把 status 翻回去」—— 只有快照
    // 才知道当时的 icon / 版本号 / 运行异常标签长什么样）
    const before = get().plugins.find((plugin) => plugin.id === id)
    const seq = (toggleSeq.get(id) ?? 0) + 1
    toggleSeq.set(id, seq)

    // 乐观：界面立刻跟着意图翻，不等后端（开关是即时的，等一次往返会让人觉得点空了）
    set((state) => ({
      plugins: state.plugins.map((plugin) =>
        plugin.id === id ? { ...plugin, status: enabled ? 'active' : 'inactive' } : plugin
      )
    }))

    try {
      const updated = await setPluginEnabled(client, id, enabled)
      // 过期响应（用户在这期间又点了一次）直接丢掉：界面归最新那次意图管
      if (toggleSeq.get(id) !== seq) return
      set((state) => ({
        plugins: state.plugins.map((plugin) =>
          plugin.id === id
            ? {
                ...updated,
                /*
                 * ★ icon **保留本机那一份**，不采信响应里的。
                 *
                 * 这个端点（服务端 handleEnable / handleDisable）回的是数据库里
                 * manifest 声明的**原始**文件名，漏了像 GET /jsplugins 那样把它解析成
                 * 磁盘上真实存在的那一个。于是草率替换会让图标当场退回首字母方块，
                 * 而且只有重拉一次列表（或重启）才恢复：
                 *   - manifest 声明 "icon.svg" 而磁盘上是 "icon.abc123.svg"（构建加了
                 *     content hash）→ 拼出的 URL 404；
                 *   - manifest 压根没声明 icon、只往 static/ 放了个 icon.svg（由后端
                 *     兜底探测出来）→ 响应里是空串，直接走兜底图。
                 * 启用 / 停用并不动插件文件，所以本机这份（来自列表响应，已解析过）
                 * 永远不比它差。（上游 Flutter 端不吃这个字段：它 toggle 后重拉整份列表。）
                 */
                icon: plugin.icon || updated.icon
              }
            : plugin
        ),
        error: null
      }))
    } catch (error) {
      // 回退：把界面还原成用户操作前的样子（后端那一步没成，本地也不该留着新状态）。
      // 已经有过更新的意图时不动 —— 那份意图有自己的回退要负责。
      if (toggleSeq.get(id) === seq && before) {
        set((state) => ({
          plugins: state.plugins.map((plugin) => (plugin.id === id ? before : plugin))
        }))
      }
      throw error
    }
  },

  remove: async (id) => {
    const client = requireClient()
    const target = get().plugins.find((plugin) => plugin.id === id)
    await deletePlugin(client, id)
    set((state) => {
      // 顺序与运行时状态也要一起清：留着的话，下次装上同名 entryPath 的插件会继承
      // 上一个插件的静音状态与排序位置 —— 用户会觉得「新插件怎么是静音的」。
      const runtime = { ...state.runtime }
      if (target) delete runtime[target.entryPath]
      return {
        plugins: state.plugins.filter((plugin) => plugin.id !== id),
        order: target ? state.order.filter((entry) => entry !== target.entryPath) : state.order,
        runtime,
        error: null
      }
    })
  },

  setRuntime: (entryPath, patch) => {
    if (!entryPath) return
    set((state) => ({
      runtime: {
        ...state.runtime,
        [entryPath]: { ...(state.runtime[entryPath] ?? IDLE_RUNTIME), ...patch }
      }
    }))
  },

  toggleMuted: (entryPath) => {
    if (!entryPath) return
    set((state) => {
      const current = state.runtime[entryPath] ?? IDLE_RUNTIME
      return {
        runtime: { ...state.runtime, [entryPath]: { ...current, muted: !current.muted } }
      }
    })
  },

  clearRuntime: (entryPath) => {
    if (!entryPath) return
    set((state) => {
      if (!(entryPath in state.runtime)) return state
      const runtime = { ...state.runtime }
      delete runtime[entryPath]
      return { runtime }
    })
  },

  reset: () => set({ plugins: [], order: [], runtime: {}, loaded: false, error: null })
}))

/** 单个扩展的运行时状态（没有记录时给一份常量，避免每次渲染生成新对象） */
export function useExtensionRuntime(entryPath: string): ExtensionRuntime {
  return usePlugins((state) => state.runtime[entryPath]) ?? IDLE_RUNTIME
}

/** 全部已安装的插件，按用户顺序（插件管理页那一列） */
export function useOrderedPlugins(): JSPlugin[] {
  const plugins = usePlugins((state) => state.plugins)
  const order = usePlugins((state) => state.order)
  return useMemo(() => applyPluginOrder(plugins, order), [plugins, order])
}

/**
 * 扩展侧栏里该列出来的那些扩展（= 点得进去的那些）。
 *
 * 先按 isDisplayable 过滤再排序（顺序不能反）：被停用的插件**留在 order 里**，
 * 重新启用后能回到原来的位置 —— 与上游 tab_config 的语义一致。
 *
 * 停用 / 运行异常的**不列**：它们没有可打开的页面，列出来点不动。它们在插件管理页里
 * 照样看得到、处理得了（那边用的是 useOrderedPlugins）。
 */
export function useDisplayablePlugins(): JSPlugin[] {
  const plugins = usePlugins((state) => state.plugins)
  const order = usePlugins((state) => state.order)
  return useMemo(() => applyPluginOrder(plugins.filter(isDisplayable), order), [plugins, order])
}

/** 把「全部已装」的顺序写回后端（拖拽排序的收口处） */
export function orderOfInstalled(plugins: JSPlugin[]): string[] {
  return entryPathsOf(plugins)
}

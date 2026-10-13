/**
 * 「我所在的这个页面，现在是不是看得见的那一页」。
 *
 * ★ 原生面的各个页面是**常驻**的（见 App 的 NativePages / PageSlot）：切页面只是把离开的
 *   那一页藏起来，不是卸载它 —— 这样页面里的筛选条件、排序方式、视图模式、滚动位置
 *   都还是离开时的样子。代价是「数据的新鲜度」不再由重新挂载自动保证，得由数据 hook 自己
 *   盯：切回来时要重取一次，但**只在数据真的变了才动界面**。
 *
 *   于是那三个数据 hook（useAsync / useSongList / usePlaylistSongs）都从这里读「我活跃吗」：
 *     * 活跃 + 首次挂载      → 正常加载（显示加载态）；
 *     * 活跃 + 条件没变地切回 → 静默刷新（不显示加载态，数据一样就一个字都不改）；
 *     * 不活跃               → 连请求都不发（藏起来的页面没人看，白跑一趟只会占带宽）。
 *
 *   把这件事放在 hook 内部、而不是让每个页面自己记得挂一次：与 useLibrary 的版本号同一个
 *   理由（见 state/useLibrary）—— 散到十几个调用点去加，迟早漏掉一处，而漏掉的那处
 *   就是一处陈旧。
 *
 * 默认 true：不在任何页面槽里的调用方（面板、播放条、设置页里的子编辑器…）按「一直在用」
 * 处理，行为与从前一致。
 */

import { createContext, useContext } from 'react'

const PageActiveContext = createContext(true)

/** 由页面槽（PageSlot）提供；页面之外的地方不需要它 */
export const PageActiveProvider = PageActiveContext.Provider

export function usePageActive(): boolean {
  return useContext(PageActiveContext)
}

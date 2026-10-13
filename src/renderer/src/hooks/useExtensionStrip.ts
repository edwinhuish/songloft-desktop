/**
 * 标题栏扩展入口条的「视窗」。
 *
 * 把入口条理解成**有序列表上的一个窗口**，而不是一段会换行的按钮：
 *
 *   ordered = 已启用的扩展，按用户排好的顺序
 *   visible = ordered.slice(offset, offset + capacity)     ← 条上画出来的
 *   hidden  = 其余（保持相对顺序）                          ← 折叠菜单里列的
 *
 * 为什么不做「最近使用的移到最前」：那会改掉用户在扩展管理页拖出来的顺序。视窗只是
 * 视图位置，它不写设置（见 useUi.extensionOffset 的注释）。
 *
 * 这套计算必须只有一份 —— 入口条与折叠菜单各自算一遍，必然会出现「菜单里列着一个
 * 其实就在条上的扩展」这种自相矛盾。所以两边都走这个 hook。
 */

import { useMemo } from 'react'

import type { JSPlugin } from '@shared/plugin'
import { useDisplayablePlugins } from '@/state/usePlugins'
import { useUi } from '@/state/useUi'

export interface ExtensionStripView {
  /** 全部该出现在入口位上的扩展，按用户顺序 */
  ordered: JSPlugin[]
  /** 当前挤进可视范围的那一段 */
  visible: JSPlugin[]
  /** 被挤出去的，供折叠菜单列出 */
  hidden: JSPlugin[]
  /** 一次装得下几个 */
  capacity: number
  /** 入口条量出实际宽度后回写 */
  setCapacity: (capacity: number) => void
  /** 点入口：已激活的就收起（回原生页），否则激活并滚进可视范围 */
  activate: (entryPath: string) => void
}

export function useExtensionStrip(): ExtensionStripView {
  const ordered = useDisplayablePlugins()
  const offset = useUi((state) => state.extensionOffset)
  const capacity = useUi((state) => state.extensionCapacity)
  const setOffset = useUi((state) => state.setExtensionOffset)
  const setCapacity = useUi((state) => state.setExtensionCapacity)

  // 越界的 offset 就地回夹：插件被卸载、或窗口变宽后，窗口不该还停在列表末尾之外
  const maxOffset = Math.max(0, ordered.length - capacity)
  const safeOffset = Math.min(offset, maxOffset)

  const visible = useMemo(
    () => ordered.slice(safeOffset, safeOffset + capacity),
    [ordered, safeOffset, capacity]
  )
  const hidden = useMemo(
    () => [...ordered.slice(0, safeOffset), ...ordered.slice(safeOffset + capacity)],
    [ordered, safeOffset, capacity]
  )

  const activate = (entryPath: string): void => {
    const ui = useUi.getState()
    const current = ui.route

    // 再点一次已激活的 = 收起扩展。必须回**原生页**而不是 back()：扩展之间互跳时，
    // history 里夹着的是另一个插件，back() 会回到那个插件而不是播放页。
    if (current.name === 'plugin' && current.entryPath === entryPath) {
      ui.navigate(ui.lastNativeRoute)
      return
    }

    // 把它滚进可视范围。取 min(index, maxOffset) 而不是直接 index：被点的那个排在
    // 末尾时，直接用它当起点会让窗口后面露出一片空白。
    const index = ordered.findIndex((plugin) => plugin.entryPath === entryPath)
    if (index >= 0) {
      const max = Math.max(0, ordered.length - capacity)
      setOffset(Math.min(index, max))
    }

    ui.navigate({ name: 'plugin', entryPath })
  }

  return { ordered, visible, hidden, capacity, setCapacity, activate }
}

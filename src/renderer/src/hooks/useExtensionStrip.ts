/**
 * 标题栏扩展入口条的排布与溢出。
 *
 * 形态是「靠左对齐的一排 图标 + 名称」，装不下的从**右边**裁掉，被裁掉的进折叠菜单：
 *
 *   ordered  = 已启用的扩展，按用户排好的顺序（若有一个刚从溢出里被激活，它排最前）
 *   capacity = 入口条实测能**完整**放下几个
 *   hidden   = ordered.slice(capacity)      ← 折叠菜单「扩展」二级菜单里列的那些
 *
 * `capacity` 只数**完全露出来**的，所以「只露了一半」与「完全没露」一样落在 `hidden` 里，
 * 都在菜单中列出来 —— 因为对它们来说菜单是唯一的入口（条上那半截点得到也不完整，
 * 不能当成入口）。这也是那里宁可用 1px 严判也不放过一个的原因。
 *
 * 为什么不再按「每个按钮固定多少像素」反推能放几个：按钮现在带名称，宽度随名字长短
 * 浮动，那个写死的常量必然算出错的个数（数少了会白白空一截，数多了会把裁掉的当成露着的）。
 * 改成量真实几何，见 components/ExtensionStrip.tsx。
 *
 * 这套计算必须只有一份 —— 入口条与折叠菜单各自算一遍，必然会出现「菜单里列着一个
 * 其实就在条上的扩展」这种自相矛盾。所以两边都走这个 hook。
 */

import { useMemo } from 'react'

import type { JSPlugin } from '@shared/plugin'
import { useDisplayablePlugins } from '@/state/usePlugins'
import { useUi } from '@/state/useUi'

export interface ExtensionStripView {
  /**
   * 该出现在入口位上的扩展，按**实际显示**顺序（含被提前的那一个）。
   *
   * 入口条要把它们**全部**渲染出来（超出的交给 CSS 裁掉）：按钮宽度随名称浮动，
   * 想量准「放得下几个」就得先有得量。
   */
  ordered: JSPlugin[]
  /** 右边裁掉的那些（含只露了一半的），供折叠菜单列出 —— 菜单是它们唯一的入口 */
  hidden: JSPlugin[]
  /** 入口条量出实际几何后回写 */
  setCapacity: (capacity: number) => void
  /** 点入口：已激活的就收起（回原生页），否则激活，并保证它露得出来 */
  activate: (entryPath: string) => void
}

export function useExtensionStrip(): ExtensionStripView {
  const installed = useDisplayablePlugins()
  const front = useUi((state) => state.extensionFront)
  const capacity = useUi((state) => state.extensionCapacity)
  const setCapacity = useUi((state) => state.setExtensionCapacity)
  const setFront = useUi((state) => state.setExtensionFront)

  /**
   * 实际显示顺序：被提出来的那个排最前，其余保持用户顺序。
   *
   * `index <= 0` 一句话盖住两种情况：它已经不在了（被卸载 / 停用），或者本来就在第一个
   * —— 都不需要动。靠这个判断，一个已经不存在的 entryPath 不会把整条顺序搅乱。
   */
  const ordered = useMemo(() => {
    if (!front) return installed
    const index = installed.findIndex((plugin) => plugin.entryPath === front)
    if (index <= 0) return installed
    return [installed[index], ...installed.slice(0, index), ...installed.slice(index + 1)]
  }, [installed, front])

  const hidden = useMemo(() => ordered.slice(capacity), [ordered, capacity])

  const activate = (entryPath: string): void => {
    const ui = useUi.getState()
    const current = ui.route

    // 再点一次已激活的 = 收起扩展。必须回**原生页**而不是 back()：扩展之间互跳时，
    // history 里夹着的是另一个插件，back() 会回到那个插件而不是播放页。
    if (current.name === 'plugin' && current.entryPath === entryPath) {
      ui.navigate(ui.lastNativeRoute)
      return
    }

    // 只有**露不出来**的那些才需要提前。裁切在右边，「移进可视范围」就只能靠改位置。
    // 露得出来的不动它 —— 否则每点一次标题栏都会重排一次，像在抽风。
    if (hidden.some((plugin) => plugin.entryPath === entryPath)) {
      setFront(entryPath)
    }

    ui.navigate({ name: 'plugin', entryPath })
  }

  return { ordered, hidden, setCapacity, activate }
}

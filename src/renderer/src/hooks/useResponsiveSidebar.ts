/**
 * 窄窗口自动把侧栏收成图标条。
 *
 * 语义刻意做成「窗口**跨过**阈值时替你按一下那个开关」，而不是把折叠态直接派生成
 * 「窗口够不够宽」。差别在于：
 *   * 直接派生的话，用户在窄窗口下手动展开会「点了没反应」（下一帧又被打回去）；
 *   * 所以这里只在跨过阈值的那一次动状态，平时完全不碰用户的选择。
 * 阈值与迟滞规则在 lib/responsive.ts，边界由那边的单测钉住。
 *
 * 由布局引发的收起**不写进设置** —— 用户保存的偏好不该被窗口尺寸覆盖，所以只打
 * `sidebarAutoCollapsed` 标记，供「窗口重新变宽时回滚」判断用；用户一旦手动点过
 * （toggleSidebar / setSidebarCollapsed 会清掉标记），之后窗口怎么变都不再自动回滚。
 */

import { useEffect } from 'react'

import { nextNarrow } from '@/lib/responsive'
import { useUi } from '@/state/useUi'

export function useResponsiveSidebar(): void {
  useEffect(() => {
    // 初值取 false：窗口本来就是窄的话，首帧就应当以图标条出现，而不是先展开再收起
    let wasNarrow = false

    const apply = (): void => {
      const narrow = nextNarrow(window.innerWidth, wasNarrow)
      if (narrow === wasNarrow) return
      wasNarrow = narrow

      const ui = useUi.getState()
      if (narrow) {
        if (!ui.sidebarCollapsed) ui.setSidebarAutoCollapsed(true)
      } else if (ui.sidebarCollapsed && ui.sidebarAutoCollapsed) {
        ui.setSidebarAutoCollapsed(false)
      }
    }

    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
}

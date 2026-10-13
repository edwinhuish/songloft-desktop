/**
 * 插件上「有反馈的动作」：停用 / 启用、卸载。
 *
 * 单独放一处，而不是让每个能触发它们的界面各写一遍：现在有**两处**能触发（插件管理页、
 * 标题栏的扩展下拉菜单），将来还可能有命令面板。看起来只是几行 toast，但其中最要紧的是
 * **卸载那句确认** —— 它会连插件在本机留下的数据一起删掉（不可恢复），漏一次就是真的丢数据。
 * 复制成两份，必然有一份先漂开。
 *
 * 说明一个例外的位置选择：`lib/` 下别的文件都是纯函数，这个不是 —— 它做的正是「执行动作
 * 并给反馈」。不放进 `state/usePlugins` 是因为那个 store 是**事实源**（拿到的插件列表、
 * 顺序、运行态），而 toast 与 confirm 是界面表达；写进 store 会让状态层反过来依赖 UI。
 */

import { pluginDisplayName, type JSPlugin } from '@shared/plugin'

import { usePlugins } from '@/state/usePlugins'
import { toast } from '@/state/useToasts'

/** 出错时把 reason 收成一句能给人看的话（拿不到就用 undefined，toast 会只显示标题） */
function reasonText(reason: unknown): string | undefined {
  return reason instanceof Error ? reason.message : undefined
}

/**
 * 启用 / 停用。
 *
 * 不乐观更新 UI：这是后端改配置、返回新对象的一步，失败要如实回滚到原来的开关位置 ——
 * 界面先跳、失败了再跳回来，比等一下更让人心里没底。
 */
export function togglePlugin(plugin: JSPlugin, next: boolean): void {
  const name = pluginDisplayName(plugin)
  void usePlugins
    .getState()
    .setEnabled(plugin.id, next)
    .then(
      () => toast(next ? `已启用「${name}」` : `已停用「${name}」`, 'success'),
      (reason: unknown) => toast('操作失败', 'error', reasonText(reason))
    )
}

/**
 * 卸载。
 *
 * 用 window.confirm 而不是自绘弹窗：仓库里所有破坏性确认都是这个路子（见
 * PlaylistsPage / SettingsPage）。它说的是**会发生什么**而不是「确定吗」——
 * 卸载会连插件的磁盘数据一起清掉，这一点必须讲明白。
 */
export function uninstallPlugin(plugin: JSPlugin): void {
  const name = pluginDisplayName(plugin)
  if (!window.confirm(`卸载「${name}」？插件在本机留下的数据会一并删除，不可恢复。`)) return
  void usePlugins
    .getState()
    .remove(plugin.id)
    .then(
      () => toast(`已卸载「${name}」`, 'success'),
      (reason: unknown) => toast('卸载失败', 'error', reasonText(reason))
    )
}

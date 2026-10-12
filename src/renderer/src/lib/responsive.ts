/**
 * 「窗口够不够窄」的判定 —— 和 React 无关，单独放这里好让边界能被单测钉住。
 *
 * 两个阈值之间是**迟滞区**：进来要跨过 1240，出去要跨过 1340。中间那 100px 里
 * 维持上一次的结论。少了它，用户把窗口拖到 1240 附近来回 1px 就会让侧栏反复
 * 展开收起（而且每次都带着 320ms 的过渡），看着像抽风 —— 这种缺陷靠手点是很难
 * 稳定复现的，所以它必须是一条可断言的规则。
 *
 * 阈值取值依据：最小窗口宽 1080、默认窗口 1440（见 main/windows.ts 与 main/store.ts）
 * —— 也就是只有用户真的把窗口拖窄了才会进迟滞区，常规尺寸下侧栏始终是展开的。
 */

/** 窄于它 → 侧栏收成图标条 */
export const SIDEBAR_COLLAPSE_BELOW = 1240

/** 宽于它 → 允许把「因窄而自动收起」的那次展开回来 */
export const SIDEBAR_EXPAND_ABOVE = 1340

/**
 * 给定当前宽度与上一次的判定，算出这一次是否算「窄」。
 *
 * 注意它返回的是**状态**而不是「要不要动作」：调用方要靠它和上一次的比较
 * 才知道自己是不是刚好跨过了阈值（只在跨越时动一次，平时不碰用户的选择）。
 */
export function nextNarrow(width: number, wasNarrow: boolean): boolean {
  if (width < SIDEBAR_COLLAPSE_BELOW) return true
  if (width > SIDEBAR_EXPAND_ABOVE) return false
  return wasNarrow
}

/**
 * 播放模式（顺序 / 列表循环 / 单曲循环 / 随机）在界面上长什么样：图标与文案。
 *
 * ★ 为什么单开这一个模块，而不是照旧长在 PlayerBar.tsx 里：这三样东西被**三处播放界面**
 *   共用 —— 底栏（PlayerBar）、满窗播放（FullPlayer）、迷你条（MiniPlayer）。原先它们长在
 *   底栏那个文件里，另外两处便各自 import 了一份「主播放器」的模块；而迷你条还跑在**另一个
 *   窗口**里（见 main/mini-window.ts），那一下等于让迷你窗反向依赖主窗口的界面。「播放模式
 *   长什么样」本就不属于任何一个播放界面 —— 搬出来之后三处都是它的下游，谁也不欠谁。
 * ★ 也不放进 shared/：这里要 IconRepeat / IconRepeatOne / IconShuffle 这几个 React 组件
 *   （见 Icons.tsx），而 shared/ 只放两侧共用的**纯代码**（不 import 渲染层的任何东西，
 *   见 AGENTS.md 的硬性约定），主进程也用不到这几颗图标。
 * ★ 下面两张表都声明成 Record<PlayMode, …> 而非普通对象：shared/types.ts 那边加一档模式时，
 *   缺的那一格由类型检查当场指出来，而不是「界面上少了一颗图标，谁也没发现」。
 */

import type { PlayMode } from '@shared/types'

import { IconRepeat, IconRepeatOne, IconShuffle } from './Icons'

/**
 * 播放模式 → 图标。
 *
 * ★ 做成**收尺寸的函数**而不是一张固定尺寸的表：模式键出现在三处，三处的图标尺寸并不相同
 *   （底栏与满窗播放走下面那张表，迷你条自己给 16，见 MiniPlayer.tsx 的 ICON_CTL），而
 *   「哪种模式配哪颗图标」只有这一份事实源 —— 复制成三张表出去，迟早只有一处还记得
 *   `random` 该换成 IconShuffle。
 */
export function modeIcon(mode: PlayMode, size: number): React.ReactNode {
  switch (mode) {
    case 'single':
      return <IconRepeatOne size={size} />
    case 'random':
      return <IconShuffle size={size} />
    default:
      // order 与 loop 是同一颗图标（有区别的只是行为与文案，见 MODE_LABEL）
      return <IconRepeat size={size} />
  }
}

/**
 * 底栏那一档的图标尺寸（满窗播放直接复用这张表，所以也是它那一档）。
 * 提成常量而不是在下面各写一个 24：这一档日后要调，改一处就够。
 */
const MODE_ICON_SIZE = 24

/**
 * 图标表：尺寸在**这里**定死，调用方只管取。
 *
 * ★ 保留这张表而不是让每个调用方各写 `modeIcon(playMode, 24)`：尺寸散在调用点的话，
 *   想统一调一档就得挨个改；而这一档的成员只有「底栏 / 满窗播放」，迷你条不跟着它走。
 */
export const MODE_ICON: Record<PlayMode, React.ReactNode> = {
  order: modeIcon('order', MODE_ICON_SIZE),
  loop: modeIcon('loop', MODE_ICON_SIZE),
  single: modeIcon('single', MODE_ICON_SIZE),
  random: modeIcon('random', MODE_ICON_SIZE)
}

/** 播放模式 → 按钮文案（data-tip 与 aria-label 共用同一份说法，三处口径因此不会各写一套） */
export const MODE_LABEL: Record<PlayMode, string> = {
  order: '顺序播放',
  loop: '列表循环',
  single: '单曲循环',
  random: '随机播放'
}

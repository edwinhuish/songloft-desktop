/**
 * 媒体键与系统媒体控件。
 *
 * 两条路一起上，因为 Linux 桌面差异很大：
 *   1. 渲染层用 Media Session API（Chromium 直接接 MPRIS）—— 这是主路径，
 *      系统托盘媒体控件、播放/暂停、上一首/下一首都靠它，零额外依赖。
 *   2. 主进程 globalShortcut 作为兜底：某些桌面环境不会把 XF86Audio* 键
 *      转发给 Chromium 的媒体会话，这时全局快捷键还能救回来。
 *
 * globalShortcut 注册失败是**正常情况**（键被桌面环境自己占了），只记日志不报错。
 */

import { globalShortcut } from 'electron'

import type { MediaCommand } from '@shared/ipc'

interface Binding {
  accelerator: string
  command: MediaCommand
}

const BINDINGS: Binding[] = [
  { accelerator: 'MediaPlayPause', command: { kind: 'play-pause' } },
  { accelerator: 'MediaNextTrack', command: { kind: 'next' } },
  { accelerator: 'MediaPreviousTrack', command: { kind: 'previous' } },
  { accelerator: 'MediaStop', command: { kind: 'play-pause' } }
]

export function registerMediaKeys(onCommand: (command: MediaCommand) => void): () => void {
  const registered: string[] = []

  for (const binding of BINDINGS) {
    try {
      if (globalShortcut.register(binding.accelerator, () => onCommand(binding.command))) {
        registered.push(binding.accelerator)
      } else {
        console.warn(
          `[Songloft-Desktop] ${binding.accelerator} 已被占用，跳过（Media Session 仍可工作）`
        )
      }
    } catch (error) {
      console.warn(`[Songloft-Desktop] 注册 ${binding.accelerator} 失败`, error)
    }
  }

  console.log(`[Songloft-Desktop] 已接管 ${registered.length}/${BINDINGS.length} 个媒体键`)
  return () => {
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
  }
}

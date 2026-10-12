/**
 * 窗口自己声明的应用图标（X11 / Windows / macOS 的任务栏、Alt-Tab、Dock 用它）。
 *
 * ★ 但**Wayland 下这份图标根本传不出去**：`xdg_toplevel` 协议里没有图标字段
 *   （合成器至今也没有 `xdg-toplevel-icon-v1`）。GNOME 那边认的是
 *   「窗口 app_id → 宿主上同名的 .desktop 条目 → 条目里的 Icon=」这条链，
 *   跟窗口自己报了什么无关 —— 详见 AGENTS.md §8.11。
 *   两条路都要留着：任一平台缺一条，症状都只是「图标没生效」，没有任何报错。
 *
 * 候选按「打包态 → 开发态」排：打包态 build/ 不进包，图标由 extraResources 投到
 * resources/icon.png；开发态直接读仓库里的位图母版（build/ 永远在，不会被 gitignore）。
 * ⚠️ 少写任何一条候选，症状同样只是「图标没生效」，宁可多留几条。
 */

import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function candidatePaths(): string[] {
  return [
    // 打包态：electron-builder.yml 的 extraResources 把图标落到这里
    join(process.resourcesPath ?? '', 'icon.png'),
    // 开发态：位图母版的派生尺寸，再兜底母版本身
    join(app.getAppPath(), 'build', 'icons', '512x512.png'),
    join(app.getAppPath(), 'build', 'icon-source.png')
  ]
}

/**
 * 读一枚可用的应用图标。拿不到就返回 null —— 图标问题不该拦住应用启动，
 * 窗口用系统默认图标照常开。
 *
 * ⚠️ 只对 X11 / Windows / macOS 有效：Wayland 没有「窗口图标」这个概念（见文件头）。
 */
export function loadAppIcon(): NativeImage | null {
  for (const file of candidatePaths()) {
    if (!file || !existsSync(file)) continue
    const image = nativeImage.createFromPath(file)
    if (!image.isEmpty()) return image
  }
  return null
}

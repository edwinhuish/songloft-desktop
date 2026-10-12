/**
 * 应用图标（任务栏 / Dock / Alt-Tab 列表里那一枚）。
 *
 * ★ 为什么必须显式交给窗口：任务栏图标来自**应用自己声明的**那一份；不给就退回
 *   Electron 自带那枚 —— 开发态最容易看见（任务栏与 Alt-Tab 里写着 Electron，而不是
 *   本应用）。打包态虽然 .desktop 与 app_id 对齐后 GNOME 会据此合并图标，但那是
 *   「装了 .desktop 的桌面环境」额外给的好处；窗口自己报出的这一份才是兜底。
 *
 * 候选按「打包态 → 开发态」排：打包态 build/ 不进包，图标由 extraResources 投到
 * resources/icon.png；开发态直接读仓库里的位图母版（build/ 永远在，不会被 gitignore）。
 * ⚠️ 少写任何一条候选，症状都只是「图标没生效」，没有任何报错 —— 宁可多留几条。
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
 */
export function loadAppIcon(): NativeImage | null {
  for (const file of candidatePaths()) {
    if (!file || !existsSync(file)) continue
    const image = nativeImage.createFromPath(file)
    if (!image.isEmpty()) return image
  }
  return null
}

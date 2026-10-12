/**
 * 对外链接的单一事实源。
 *
 * 主进程（「帮助」菜单）与渲染层（设置页「关于」）都要打开这两个地址。
 * 写在一处是为了避免两边各存一份字符串、日后只改了一边。
 *
 * 注意区分：
 *   * REPO_URL     —— **本仓库**（Electron 桌面客户端）
 *   * UPSTREAM_URL —— **上游原项目**（Flutter 客户端 + Go 后端），本仓库是它的桌面重写版
 */

/** 本仓库：github.com/edwinhuish/songloft-desktop */
export const REPO_URL = 'https://github.com/edwinhuish/songloft-desktop'

/** 上游原项目：github.com/songloft-org/songloft-player */
export const UPSTREAM_URL = 'https://github.com/songloft-org/songloft-player'

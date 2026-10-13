/** preload 与渲染层共享的纯类型（放这里避免 shared/bridge 反向依赖主进程代码） */

export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresIn: number
  /**
   * 登录时填的用户名。
   *
   * 后端没有任何「我是谁」的接口（`/auth/login` 只回 token），所以界面要显示账号
   * 就只能自己记。它跟着凭据按服务器隔离 —— 换个服务器就是另一个账号。
   *
   * ⚠️ 可选：token 静默刷新时只会带 token 三件套，主进程侧因此是**合并写入**
   * （见 `ConfigStore.setCredentials`），整条覆盖会把用户名抹掉。
   */
  username?: string
  savedAt: number
}

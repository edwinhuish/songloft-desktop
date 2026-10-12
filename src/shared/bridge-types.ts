/** preload 与渲染层共享的纯类型（放这里避免 shared/bridge 反向依赖主进程代码） */

export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresIn: number
  savedAt: number
}

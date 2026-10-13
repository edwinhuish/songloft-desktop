/**
 * 登录 / 选择服务器。
 *
 * 桌面端相对移动端多出来的三件事：
 *   1. **服务器地址是一等公民** —— songloft 后端不是云服务，地址必须手填；
 *   2. **探测按钮**：填完地址先点一下，能立刻分出「地址错了」「服务没起来」
 *      「地址对但需要 TLS 放行」三种情况，而不是登录失败后盲猜；
 *   3. **已保存服务器列表**：多台 NAS 之间切换，不该每次重敲地址。
 */

import { useEffect, useState } from 'react'

import type { ServerProbeResult } from '@shared/ipc'
import {
  IconAlert,
  IconCheck,
  IconLoader,
  IconServer,
  IconSparkle,
  IconTrash
} from '@/components/Icons'
import { Switch } from '@/components/primitives'
import { useAuth } from '@/state/useAuth'
import { useSettings } from '@/state/useSettings'
import { useToasts } from '@/state/useToasts'

const DEFAULT_URL = 'http://localhost:58091'

const FEATURES = [
  '本地 / 网络 / 电台三类曲库统一管理',
  '逐字高亮歌词，点击任意一行直接跳转',
  '封面取色驱动全界面强调色',
  '媒体键与托盘常驻，最小化也能继续放'
]

export function LoginPage(): React.JSX.Element {
  const { servers, busy, error, probe, login, switchServer, forgetServer } = useAuth()
  const { settings, patch } = useSettings()
  const push = useToasts((s) => s.push)

  const [url, setUrl] = useState(servers[0]?.url ?? DEFAULT_URL)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ServerProbeResult | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  // 服务器列表异步到达时，第一次填充默认地址（用户已经改过就别动）
  useEffect(() => {
    setUrl((current) => (current === DEFAULT_URL && servers[0] ? servers[0].url : current))
  }, [servers])

  const handleProbe = async (): Promise<void> => {
    const target = url.trim()
    if (!target) {
      setLocalError('请先填写服务器地址')
      return
    }
    setProbing(true)
    setLocalError(null)
    setProbeResult(null)
    try {
      setProbeResult(await probe(target))
    } catch (err) {
      setProbeResult({
        ok: false,
        version: null,
        healthy: false,
        error: err instanceof Error ? err.message : '探测失败',
        elapsedMs: 0
      })
    } finally {
      setProbing(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setLocalError(null)
    if (!url.trim()) {
      setLocalError('请填写服务器地址')
      return
    }
    if (!username.trim() || !password) {
      setLocalError('请填写用户名与密码')
      return
    }
    try {
      await login(url.trim(), username.trim(), password, name.trim() || undefined)
      push('登录成功', 'success')
    } catch {
      // 具体原因（401 / 网络不可达）已在 store 里落成可读文案
    }
  }

  const message = localError ?? error

  return (
    <div className="login">
      <div className="login-brand">
        <img
          src="./icon.png"
          alt=""
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
        <div>
          <h1>Songloft</h1>
          <p>
            自托管音乐库的桌面客户端。连上你自己的 songloft 后端，
            本地文件、网络歌曲与电台都在一个曲库里管。
          </p>
        </div>
        <div className="login-features">
          {FEATURES.map((feature) => (
            <div key={feature} className="login-feature">
              <IconSparkle size={15} />
              <span>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="login-form-wrap">
        <form className="login-form" onSubmit={handleSubmit}>
          <h2>连接到服务器</h2>
          <div className="sub">填后端地址与账号，凭据只保存在本机</div>

          <div className="field">
            <label className="field-label" htmlFor="server-url">
              服务器地址
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="server-url"
                className="input"
                value={url}
                placeholder={DEFAULT_URL}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(event) => {
                  setUrl(event.target.value)
                  setProbeResult(null)
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={probing}
                onClick={() => void handleProbe()}
                title="只测连通性，不登录"
              >
                {probing ? <IconLoader size={15} /> : <IconServer size={15} />}
                探测
              </button>
            </div>

            {probeResult ? (
              <div className="probe-result" data-state={probeResult.ok ? 'ok' : 'error'}>
                {probeResult.ok ? <IconCheck size={15} /> : <IconAlert size={15} />}
                <span>
                  {probeResult.ok
                    ? `连接正常${probeResult.version ? ` · 后端 ${probeResult.version}` : ''}${
                        probeResult.healthy ? '' : '（健康检查未通过）'
                      }`
                    : (probeResult.error ?? '无法连接')}
                  {probeResult.elapsedMs > 0 ? ` · ${probeResult.elapsedMs}ms` : ''}
                </span>
              </div>
            ) : (
              <div className="field-hint">
                后端默认监听 58091 端口。自签证书的 HTTPS 要先打开下面的证书放行开关，
                否则探测与登录都会失败。
              </div>
            )}
          </div>

          <div className="row-between">
            <div>
              <div className="field-label">允许自签 / 无效 TLS 证书</div>
              <div className="field-hint">
                只在内网自建、明确知道风险时打开；打开后本机不再校验证书
              </div>
            </div>
            <Switch
              ariaLabel="忽略证书校验"
              checked={settings.allowInsecureTls}
              onChange={(checked) => void patch({ allowInsecureTls: checked })}
            />
          </div>

          <div className="row" style={{ gap: 10 }}>
            <div className="field grow">
              <label className="field-label" htmlFor="login-user">
                用户名
              </label>
              <input
                id="login-user"
                className="input"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="field grow">
              <label className="field-label" htmlFor="login-pass">
                密码
              </label>
              <input
                id="login-pass"
                className="input"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="login-name">
              备注名（可选）
            </label>
            <input
              id="login-name"
              className="input"
              value={name}
              placeholder="例如：家里的 NAS"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {message ? (
            <div className="probe-result" data-state="error">
              <IconAlert size={15} />
              <span>{message}</span>
            </div>
          ) : null}

          <button
            type="submit"
            className="btn"
            data-variant="primary"
            data-size="lg"
            disabled={busy}
          >
            {busy ? <IconLoader size={16} /> : null}
            {busy ? '正在登录…' : '登录'}
          </button>

          {servers.length > 0 ? (
            <>
              <div className="divider" />
              <div className="field-label">已保存的服务器</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: -4 }}>
                {servers.map((server) => (
                  <div
                    key={server.url}
                    className="row"
                    style={{ gap: 6, padding: '5px 8px', borderRadius: 'var(--r-sm)' }}
                  >
                    <button
                      type="button"
                      className="grow truncate"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        padding: '4px 0',
                        color: 'var(--text-2)'
                      }}
                      title={server.url}
                      onClick={() => {
                        setUrl(server.url)
                        setName(server.name)
                        setProbeResult(null)
                        setLocalError(null)
                      }}
                    >
                      <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{server.name}</div>
                      <div className="truncate" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                        {server.url}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-size="sm"
                      data-variant="ghost"
                      title="用已保存的凭据直接进入"
                      onClick={() => void switchServer(server.url)}
                    >
                      直接进入
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="移除该服务器"
                      aria-label={`移除 ${server.name}`}
                      onClick={() => void forgetServer(server.url)}
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </form>
      </div>
    </div>
  )
}

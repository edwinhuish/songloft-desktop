/**
 * 插件商店（扩展管理页的右列）。
 *
 * 数据来自后端对订阅源的聚合结果（`POST /jsplugins/registry/refresh`）。三件事一律交给
 * 后端判断、前端绝不自己算：**装没装**（installed）、**能不能更新**（has_update）、
 * **是不是撞了别人的 entryPath**（conflict / conflict_with）。版本比较的规则在后端，
 * 前端再实现一遍必然漂移 —— 到时候界面说「可更新」、点了却装不进去。
 *
 * `force` 只在点「刷新」时传：后端对订阅源有 5 分钟缓存，翻页与搜索都带上它等于每次
 * 翻页都去重拉一遍远端，又慢又容易撞上源的限流。
 */

import { useEffect, useRef, useState } from 'react'

import { pluginFallbackHue } from '@shared/plugin'
import { ApiError } from '@/api/client'
import { getGithubProxy } from '@/api/endpoints'
import {
  installFromRegistry,
  refreshRegistry,
  registryRowKey,
  type RegistryEntry
} from '@/api/plugins'
import { IconDownload, IconLoader, IconRefresh, IconStore } from '@/components/Icons'
import { EmptyState } from '@/components/primitives'
import { useAuth } from '@/state/useAuth'
import { usePlugins } from '@/state/usePlugins'
import { toast } from '@/state/useToasts'

/** 一页拉多少。太小翻页频繁，太大一次请求拿回一堆用不上的 manifest */
const PAGE_SIZE = 20

export function PluginStore(): React.JSX.Element {
  const client = useAuth((state) => state.client)

  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 正在安装的那一行（按 registryRowKey）。同一时刻只允许一个，避免重复点出两次安装 */
  const [pending, setPending] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * 两处一次性标志，刻意用 ref 而不是 state：它们只是「这一次要不要强制」与
   * 「这次拉回来是追加还是替换」，写进 state 会让它们自己成为依赖，进而触发下一轮请求。
   */
  const forceRef = useRef(false)
  const proxyRef = useRef('')

  // 输入防抖：每敲一个字都去戳一次远端（还要穿过 GitHub 代理）既慢又扰民
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(input.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        // 后端不会自己去读它存的那份代理配置，必须显式带上；拉一次就记住
        if (!proxyRef.current) proxyRef.current = await getGithubProxy(client)
        const result = await refreshRegistry(client, {
          page,
          pageSize: PAGE_SIZE,
          search: keyword,
          force: forceRef.current,
          githubProxy: proxyRef.current
        })
        if (cancelled) return
        // 第 1 页是替换，其余是追加 —— 用 page 判断而不是清空重来，
        // 这样「加载更多」不会让已经看到的那些闪一下
        setEntries((previous) => (page === 1 ? result.plugins : [...previous, ...result.plugins]))
        setTotal(result.total)
        setWarnings(result.warnings)
        setError(null)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '插件商店打不开')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          forceRef.current = false
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client, keyword, page, reloadToken])

  const refresh = (): void => {
    forceRef.current = true
    // page 本来就是 1 时 setPage 是空操作，靠 reloadToken 把 effect 捅醒
    setPage(1)
    setReloadToken((token) => token + 1)
  }

  const install = async (entry: RegistryEntry, overwrite = false): Promise<void> => {
    if (!client) return
    const key = registryRowKey(entry)
    setPending(key)
    try {
      if (!proxyRef.current) proxyRef.current = await getGithubProxy(client)
      const result = await installFromRegistry(client, {
        downloadUrl: entry.downloadUrl,
        sourceUrl: entry.sourceUrl,
        githubProxy: proxyRef.current,
        overwrite
      })
      // 后端把「安装失败」也放在 200 的 body 里（success: 0），所以要看结果而不是看有没有抛
      if (result.success === 0) {
        throw new Error(result.results[0]?.error || result.message || '安装失败')
      }
      toast(`已安装「${entry.name || entry.entryPath}」`, 'success')
      // 插件列表变了 → 标题栏的入口条要跟着多出一个按钮
      await usePlugins.getState().load()
      // 重拉一次让这一行从「安装」变成「已安装」，也让 has_update 归零
      setReloadToken((token) => token + 1)
    } catch (reason) {
      // ★ 409 = 同一个 entryPath 被**另一个作者**的插件占着，后端什么都没写。
      //   必须先问清楚，用户点头了才带 overwrite 重发。
      if (reason instanceof ApiError && reason.status === 409) {
        const occupant = entry.conflictWith || '本机已有的同入口插件'
        const ok = window.confirm(
          `${occupant} 占用了同一个入口，继续安装会替换掉它（它的数据也会被清掉）。继续？`
        )
        setPending(null)
        if (ok) await install(entry, true)
        return
      }
      toast('安装失败', 'error', reason instanceof Error ? reason.message : undefined)
    } finally {
      setPending(null)
    }
  }

  const hasMore = entries.length < total

  return (
    <section>
      <h2 className="section-title">
        插件商店
        <button
          type="button"
          className="icon-btn"
          data-tip="刷新商店（会绕过服务端缓存）"
          aria-label="刷新插件商店"
          onClick={refresh}
        >
          <IconRefresh size={15} />
        </button>
      </h2>

      <input
        className="input"
        type="search"
        value={input}
        placeholder="搜索扩展…"
        aria-label="搜索扩展"
        onChange={(event) => setInput(event.target.value)}
      />

      {warnings.length ? (
        <p className="field-hint" style={{ marginTop: 10 }}>
          {warnings.join(' · ')}
        </p>
      ) : null}

      {error ? (
        <EmptyState
          icon={<IconStore size={26} />}
          title="插件商店打不开"
          description={error}
          action={
            <button type="button" className="btn" data-size="sm" onClick={refresh}>
              重试
            </button>
          }
        />
      ) : null}

      {!error && !loading && entries.length === 0 ? (
        <EmptyState
          icon={<IconStore size={26} />}
          title={keyword ? '没有匹配的扩展' : '商店里还没有扩展'}
          description={
            keyword
              ? '换个关键词试试。'
              : '这台服务器还没订阅任何扩展源 —— 可以在服务端设置里添加订阅源。'
          }
        />
      ) : null}

      {!error && entries.length > 0 ? (
        <ul className="extension-list" style={{ marginTop: 12 }}>
          {entries.map((entry) => (
            <StoreRow
              key={registryRowKey(entry)}
              entry={entry}
              pending={pending === registryRowKey(entry)}
              disabled={pending !== null && pending !== registryRowKey(entry)}
              onInstall={() => void install(entry)}
            />
          ))}
        </ul>
      ) : null}

      {!error && loading && entries.length === 0 ? (
        <div className="empty">
          <IconLoader size={22} />
        </div>
      ) : null}

      {!error && hasMore ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button
            type="button"
            className="btn"
            data-size="sm"
            disabled={loading}
            onClick={() => setPage((current) => current + 1)}
          >
            {loading ? <IconLoader size={14} /> : null}
            加载更多（还有 {total - entries.length} 个）
          </button>
        </div>
      ) : null}
    </section>
  )
}

/* ─────────────────────────────── 单行 ─────────────────────────────── */

interface StoreRowProps {
  entry: RegistryEntry
  pending: boolean
  disabled: boolean
  onInstall: () => void
}

function StoreRow({ entry, pending, disabled, onInstall }: StoreRowProps): React.JSX.Element {
  const name = entry.name || entry.entryPath

  /**
   * 按钮文案与样式的唯一判据是后端那三个字段。
   *
   * 顺序不能反：conflict 优先于 installed —— 撞名的那一条 `installed` 是 false
   * （本地装的根本不是它），只看 installed 会把它显示成「安装」，点下去才发现要覆盖。
   */
  let label = '安装'
  let variant = 'primary'
  let tone: 'accent' | 'warning' | 'danger' | undefined
  if (entry.conflict) {
    label = '覆盖安装'
    variant = 'danger'
    tone = 'danger'
  } else if (entry.hasUpdate) {
    label = '更新'
    tone = 'accent'
  } else if (entry.installed) {
    label = '已安装'
    variant = ''
  }

  const meta = [
    `v${entry.version || '—'}`,
    entry.author,
    entry.installed && entry.installedVersion && entry.installedVersion !== entry.version
      ? `本机 v${entry.installedVersion}`
      : '',
    entry.description
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="extension-row">
      <StoreIcon entry={entry} name={name} />

      <div className="extension-info">
        <div className="extension-name">
          {name}
          {entry.sourceName ? <span className="badge">{entry.sourceName}</span> : null}
          {tone ? (
            <span className="badge" data-tone={tone}>
              {entry.conflict ? '入口冲突' : '有新版本'}
            </span>
          ) : null}
        </div>
        <div className="extension-meta truncate">{meta}</div>
        {entry.conflict && entry.conflictWith ? (
          <div className="extension-meta truncate">已被 {entry.conflictWith} 占用</div>
        ) : null}
      </div>

      <button
        type="button"
        className="btn"
        data-size="sm"
        data-variant={variant || undefined}
        // 已安装且没有新版本时没什么可点；别的行正在装时也先别让人开第二个
        disabled={pending || disabled || (entry.installed && !entry.hasUpdate && !entry.conflict)}
        onClick={onInstall}
      >
        {pending ? <IconLoader size={14} /> : <IconDownload size={14} />}
        {label}
      </button>
    </li>
  )
}

/**
 * 商店条目的图标。
 *
 * 只认**绝对 http(s) URL**：商店条目的 icon 来自各个订阅源的 manifest，写法五花八门，
 * 相对路径的基准是「那个源」，不是我们的后端 —— 照着拼只会拼出一个必然 404 的地址。
 * 拿不准就退到按名字取色的首字母。
 */
function StoreIcon({ entry, name }: { entry: RegistryEntry; name: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const remote = /^https?:\/\//i.test(entry.icon) ? entry.icon : ''

  if (remote && !broken) {
    return (
      <img
        className="plugin-icon"
        src={remote}
        alt=""
        width={34}
        height={34}
        onError={() => setBroken(true)}
      />
    )
  }

  return (
    <span
      className="plugin-icon plugin-icon-fallback"
      aria-hidden="true"
      style={{
        width: 34,
        height: 34,
        fontSize: 20,
        background: `hsl(${pluginFallbackHue(name)} 58% 46%)`
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * 插件商店 —— 扩展主框架右侧的一栏（框架与左栏见 components/ExtensionFrame.tsx）。
 *
 * 数据来自后端对订阅源的聚合结果（`POST /jsplugins/registry/refresh`）。三件事一律交给
 * 后端判断、前端绝不自己算：**装没装**（installed）、**能不能更新**（has_update）、
 * **是不是撞了别人的 entryPath**（conflict / conflict_with）。版本比较的规则在后端，
 * 前端再实现一遍必然漂移 —— 到时候界面说「可更新」、点了却装不进去。
 *
 * `force` 只在点「刷新」时传：后端对订阅源有 5 分钟缓存，翻页与搜索都带上它等于每次都去
 * 重拉一遍远端，又慢又容易撞上源的限流。
 *
 * ★ 列表是**无限滚动**（滚到底自动续下一页），不再给「加载更多」按钮：这是「逛」的场景，
 *   让人盯着一颗按钮点，不如让列表跟着滚动自己长出来。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { pluginFallbackHue } from '@shared/plugin'
import { ApiError } from '@/api/client'
import { getGithubProxy } from '@/api/endpoints'
import {
  getPluginRegistries,
  installFromRegistry,
  refreshRegistry,
  registryRowKey,
  type RegistryEntry,
  type RegistrySource
} from '@/api/plugins'
import { IconDownload, IconLoader, IconRefresh, IconSliders, IconStore } from '@/components/Icons'
import { EmptyState, InfiniteSentinel } from '@/components/primitives'
import { RegistrySourcesDialog } from '@/components/RegistrySourcesDialog'
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
  /** 已经翻到底了（某页空着回来）。它比 `entries.length < total` 更硬，见下面那处 setExhausted */
  const [exhausted, setExhausted] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 正在安装的那一行（按 registryRowKey）。同一时刻只允许一个，避免重复点出两次安装 */
  const [pending, setPending] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /* 订阅源：一份给筛选下拉，一份留给「管理订阅源」对话框去改 */
  const [sources, setSources] = useState<RegistrySource[]>([])
  /** 空串 = 聚合所有启用的源（后端的默认行为） */
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [sourcesToken, setSourcesToken] = useState(0)

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

  /**
   * 读订阅源列表。
   *
   * 失败**不弹错**：商店在聚合模式下照样能用（后端自己有默认源），少一个筛选下拉而已。
   * 真想看为什么，打开「管理订阅源」——那边会把错误明说。
   */
  const reloadSources = useCallback((): void => {
    if (!client) return
    getPluginRegistries(client)
      .then((list) => {
        setSources(list)
        // 选中的那个源可能刚被删掉或改了地址。留着它的话下一次请求会 400
        // （单源模式的 `registry_url` 指向一个不存在的源），所以退回「全部订阅源」
        setSourceUrl((current) =>
          current && !list.some((source) => source.url === current) ? '' : current
        )
      })
      .catch(() => undefined)
  }, [client])

  useEffect(() => {
    reloadSources()
  }, [reloadSources, sourcesToken])

  /** 当前筛选的那个源（没筛选时为 undefined） */
  const selectedSource = sources.find((source) => source.url === sourceUrl)
  /** 它的 token（没有筛选、或它是公开源时为空串） */
  const sourceToken = selectedSource?.token ?? ''

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
          githubProxy: proxyRef.current,
          // 单源筛选：后端在这个模式下不会去读已保存的配置，私有源的 token 得自己带上
          sourceUrl,
          sourceToken
        })
        if (cancelled) return
        // 第 1 页是替换，其余是追加 —— 用 page 判断而不是清空重来，
        // 这样「滚到底续下一页」不会让已经看到的那些闪一下
        setEntries((previous) => (page === 1 ? result.plugins : [...previous, ...result.plugins]))
        setTotal(result.total)
        // 空着回来却还有 total 没走完：说明服务端那份名单在翻页途中变了（订阅源缓存过期）。
        // 就此打住 —— 否则滚到底会一页页地要空页，把服务端刷爆
        setExhausted(result.plugins.length === 0)
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
    // 依赖里放的是 sourceToken 这个**字符串**而不是整份 sources：后者每次读源列表都会换
    // 引用，跟着它重跑等于挂载时白拉一次（用户什么都没改）
  }, [client, keyword, page, reloadToken, sourceUrl, sourceToken])

  const refresh = (): void => {
    forceRef.current = true
    // page 本来就是 1 时 setPage 是空操作，靠 reloadToken 把 effect 捅醒
    setPage(1)
    setReloadToken((token) => token + 1)
  }

  const hasMore = !exhausted && entries.length < total

  /**
   * 续下一页。
   *
   * `loading` 这道闸不能省：IntersectionObserver 在「内容还填不满一屏」时会连着触发，
   * 没有它就会同时发好几页（后面的响应会把前面的替换掉，列表里于是出现空洞）。
   */
  const loadMore = useCallback((): void => {
    if (loading || !hasMore) return
    setPage((current) => current + 1)
  }, [loading, hasMore])

  const install = async (entry: RegistryEntry, overwrite = false): Promise<void> => {
    if (!client) return
    const key = registryRowKey(entry)
    setPending(key)
    try {
      if (!proxyRef.current) proxyRef.current = await getGithubProxy(client)
      const result = await installFromRegistry(client, {
        downloadUrl: entry.downloadUrl,
        // 聚合模式条目的 sourceUrl 就是它的来源；单源筛选模式下条目不带这个字段，
        // 那时「来源」就是当前选中的那个源 —— 两种都只是把 URL 交给后端，token 由它自己查
        sourceUrl: entry.sourceUrl || sourceUrl,
        githubProxy: proxyRef.current,
        overwrite
      })
      // 后端把「安装失败」也放在 200 的 body 里（success: 0），所以要看结果而不是看有没有抛
      if (result.success === 0) {
        throw new Error(result.results[0]?.error || result.message || '安装失败')
      }
      toast(`已安装「${entry.name || entry.entryPath}」`, 'success')
      // 插件列表变了 → 扩展侧栏里要跟着多出一项
      await usePlugins.getState().load()
      /**
       * 只把这一行就地改成「已安装」，**不重拉列表**。
       *
       * 重拉会把第 1 页追加到现有列表后面（effect 按 `page > 1` 判追加），在翻过几页之后
       * 等于把已看过的那些再来一遍；退回第 1 页倒是不会重复，但用户的滚动位置就丢了 ——
       * 装完一个还想接着往下逛，结果被弹回顶上。
       */
      setEntries((previous) =>
        previous.map((item) =>
          registryRowKey(item) === key
            ? {
                ...item,
                installed: true,
                installedVersion: item.version,
                hasUpdate: false,
                conflict: false,
                conflictWith: ''
              }
            : item
        )
      )
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

  /** 源改过之后：商店那份列表与筛选选项都得重新来过（后端也会顺手作废它的缓存） */
  const onSourcesSaved = (): void => {
    setSourcesToken((token) => token + 1)
    setPage(1)
    setReloadToken((token) => token + 1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <IconStore size={24} />
            插件商店
          </h1>
          <p className="page-subtitle">
            列表来自服务端的扩展订阅源，安装与更新都在服务端完成。
            {total > 0 ? ` 已载入 ${entries.length} / ${total} 个。` : ''}
          </p>
        </div>

        <div className="row">
          <button type="button" className="btn" data-size="sm" onClick={() => setSourcesOpen(true)}>
            <IconSliders size={14} />
            管理订阅源
          </button>
          <button type="button" className="btn" data-size="sm" onClick={refresh}>
            <IconRefresh size={14} />
            刷新商店
          </button>
        </div>
      </div>

      {/* 搜索框不铺满整行：这一栏宽起来能有上千像素，一条横贯全屏的输入框反而不好对焦。
          筛选下拉紧挨着它，「搜什么 + 搜哪儿」是同一件事的两半 */}
      <div className="row">
        <input
          className="input"
          type="search"
          value={input}
          placeholder="搜索扩展…"
          aria-label="搜索扩展"
          style={{ maxWidth: 420 }}
          onChange={(event) => setInput(event.target.value)}
        />
        <select
          className="input"
          value={sourceUrl}
          aria-label="筛选订阅源"
          style={{ width: 240, flex: 'none' }}
          onChange={(event) => {
            setSourceUrl(event.target.value)
            setPage(1)
            setReloadToken((token) => token + 1)
          }}
        >
          <option value="">全部订阅源</option>
          {sources.map((source) => (
            <option key={source.url} value={source.url}>
              {source.name || source.url}
              {/* 停用的源不在聚合结果里，但单独看它是允许的 —— 标出来才不会被当成「源没了」 */}
              {source.enabled ? '' : '（已停用）'}
            </option>
          ))}
        </select>
      </div>

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
              ? '换个关键词试试，或把筛选切回「全部订阅源」。'
              : selectedSource
                ? `「${selectedSource.name || selectedSource.url}」里没有可装的扩展。`
                : sources.length === 0
                  ? '还没有配置订阅源 —— 点右上角「管理订阅源」加一个。'
                  : '已配置的订阅源里没有可装的扩展。'
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

      {/* 续页时只在列表底部放一枚转圈的指示，不摆骨架屏：骨架会把已有的行往下推 */}
      {!error && loading && entries.length > 0 ? (
        <div className="empty" style={{ padding: '14px 0' }}>
          <IconLoader size={18} />
        </div>
      ) : null}

      {/*
        到底的提示。★ 不能省：无限滚动的列表滚到底时「不再长出新行」与「卡住了」
        在屏幕上长得一模一样，用户只能靠反复上下来回滚来确认。给一句话，滚到底这件事
        就有了明确的下文。
        列表为空时走上面那条空态，所以这里要求 entries 非空。
      */}
      {!error && !loading && entries.length > 0 && !hasMore ? (
        <p className="list-end">已经到底了</p>
      ) : null}

      {/* key 跟着页码走：内容不够高时哨兵仍在视口里，观察器不会再来一次 —— 换一个元素
          重新挂观察器，它会立刻以「当前可见」回调一次，列表就能一路续到填满视口为止 */}
      {!error && hasMore ? <InfiniteSentinel key={page} onVisible={loadMore} /> : null}

      {sourcesOpen ? (
        <RegistrySourcesDialog onClose={() => setSourcesOpen(false)} onSaved={onSourcesSaved} />
      ) : null}
    </div>
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

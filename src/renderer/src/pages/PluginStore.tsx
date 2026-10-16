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
 *
 * ★ 卡片网格的形态参考社区插件市场（https://songloft-store.lllh.de）：一张卡 = 一个扩展，
 *   窄了自动一列、宽了自动多列；卡内自上而下是「图标 + 名称 + 动作」→ 描述 → 标签 →
 *   作者 / 版本 / 链接。原先是一行拉满整宽的列表行 —— 这一栏在宽窗口下能有上千像素，
 *   名称与按钮隔着半个屏幕，扫视时对不上。
 *   配色**不照搬**那个站（它是单主题的玻璃拟态）：这里一律走本仓的主题令牌，
 *   跟着封面主色与深浅色一起变。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { PluginIconFallback } from '@/components/PluginIcon'
import { EmptyState, InfiniteSentinel } from '@/components/primitives'
import { RegistrySourcesDialog } from '@/components/RegistrySourcesDialog'
import { buildResourceUrl } from '@/lib/url'
import { resourceContext, useAuth } from '@/state/useAuth'
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
  /**
   * ★ 初值跟着 client 走，不是写死 false：这一页的**第一帧**就该是骨架屏。
   *   写死 false 的话，effect 里那句 setLoading(true) 跑在首次绘制之后 ——
   *   会先闪一下「商店里还没有扩展」的空态、再变成骨架，正是这一屏要消掉的那种跳动。
   *   没有会话（client 为 null）时压根不会发请求，也就不该摆骨架，照旧走空态的引导。
   */
  const [loading, setLoading] = useState(client !== null)
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
      // 同一颗按钮现在有四种含义（安装 / 更新 / 重新安装 / 覆盖安装），回执也跟着说清楚，
      // 否则点了「⟳ v1.2.3」却被告知「已安装」会让人怀疑是不是没生效
      const done = entry.conflict
        ? '已覆盖安装'
        : entry.hasUpdate
          ? '已更新'
          : entry.installed
            ? '已重新安装'
            : '已安装'
      toast(`${done}「${entry.name || entry.entryPath}」`, 'success')
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
        <ul className="store-grid">
          {entries.map((entry) => (
            <StoreCard
              key={registryRowKey(entry)}
              entry={entry}
              pending={pending === registryRowKey(entry)}
              disabled={pending !== null && pending !== registryRowKey(entry)}
              onInstall={() => void install(entry)}
            />
          ))}
        </ul>
      ) : null}

      {/* 头一页还在路上：摆与真实卡片同构的骨架屏（见 StoreGridSkeleton）。
          转圈图标只说得清「在忙」，说不清「待会儿这儿会长出什么」——数据一回来卡片凭空冒出来，
          视线得重新找一遍位置 */}
      {!error && loading && entries.length === 0 ? <StoreGridSkeleton /> : null}

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

/* ─────────────────────────────── 单张卡片 ─────────────────────────────── */

interface StoreCardProps {
  entry: RegistryEntry
  pending: boolean
  disabled: boolean
  onInstall: () => void
}

/**
 * 按钮那一档长什么样。
 *
 * 四档与上游 Flutter 端 `plugin_registry.dart` 的 `_buildAction` 逐条对应：
 *   未装        → 「安装」（主色实心）
 *   入口撞名    → 「覆盖安装」（危险色）
 *   装了且可更新 → 「更新至 v<商店版本>」
 *   装了且最新  → 「⟳ v<本机版本>」= 把这一版**重新装一遍**（上游是带「重新安装」tooltip 的
 *                ActionChip），所以它**可点**，不是一块状态牌
 *
 * 顺序不能反：conflict 优先于 installed —— 撞名的那一条 `installed` 是 false
 * （本地装的根本不是它），只看 installed 会把它显示成「安装」，点下去才发现要覆盖。
 */
interface StoreAction {
  label: string
  /** 无障碍名。只有「⟳ v1.2.3」这一档看不出动词，才需要另给一句 */
  ariaLabel?: string
  variant?: 'primary' | 'danger'
  /** 名字后面那个角标 */
  tone?: 'accent' | 'danger'
  tip?: string
  /** 用「⟳」而不是「⤓」：它说的是「重新装一遍」，不是「从商店下载」 */
  refresh?: boolean
}

function describeAction(entry: RegistryEntry): StoreAction {
  if (entry.conflict) {
    return { label: '覆盖安装', variant: 'danger', tone: 'danger' }
  }
  if (entry.hasUpdate) {
    // 说的是**它会变成哪个版本**（商店里那个），不是本机现在那个
    return { label: `更新至 v${entry.version || '—'}`, tone: 'accent' }
  }
  if (entry.installed) {
    // 显示**本机版本**：这一档要回答的是「我这儿装的是哪一版」
    const version = entry.installedVersion || entry.version || '—'
    return {
      label: `v${version}`,
      ariaLabel: `重新安装 v${version}`,
      tip: '重新安装',
      refresh: true
    }
  }
  return { label: '安装', variant: 'primary' }
}

function StoreCard({ entry, pending, disabled, onInstall }: StoreCardProps): React.JSX.Element {
  const name = entry.name || entry.entryPath
  const action = describeAction(entry)

  /**
   * 卡片底部那一行的几段，先拼成**一个**字符串再渲染。
   *
   * 摆一排 span 的话逐段折行，窄到一列时看着像几段无关的字；拼起来让浏览器整句折。
   */
  const meta = [entry.author || '未知作者', `v${entry.version || '—'}`]
  if (entry.installed && entry.installedVersion && entry.installedVersion !== entry.version) {
    meta.push(`本机 v${entry.installedVersion}`)
  }

  return (
    <li className="store-card">
      <div className="store-card-top">
        <StoreIcon entry={entry} name={name} />

        <span className="store-card-name truncate" title={name}>
          {name}
        </span>

        <button
          type="button"
          className="btn store-card-action"
          data-size="sm"
          data-variant={action.variant}
          aria-label={action.ariaLabel}
          data-tip={action.tip}
          // 四档都可点（「已装且最新」= 重新装一遍）；只有别的卡片正在装时才按住，别让人开第二个
          disabled={pending || disabled}
          onClick={onInstall}
        >
          {pending ? (
            <IconLoader size={14} />
          ) : action.refresh ? (
            <IconRefresh size={14} />
          ) : (
            <IconDownload size={14} />
          )}
          {action.label}
        </button>
      </div>

      <p className="store-card-desc">{entry.description || '暂无描述'}</p>

      <div className="store-card-tags">
        {entry.sourceName ? <span className="badge">{entry.sourceName}</span> : null}
        {action.tone ? (
          <span className="badge" data-tone={action.tone}>
            {entry.conflict ? '入口冲突' : '有新版本'}
          </span>
        ) : null}
        {/* entryPath 是撞名时唯一能分辨两条的字段（后端按 entryPath + identity 去重），
            所以它得在卡片上可见；等宽是为了两条 entryPath 好逐段对照 */}
        {entry.entryPath ? (
          <span className="store-card-code truncate" title={entry.entryPath}>
            {entry.entryPath}
          </span>
        ) : null}
      </div>

      {entry.conflict && entry.conflictWith ? (
        <p className="store-card-note">已被 {entry.conflictWith} 占用</p>
      ) : null}

      <div className="store-card-foot">
        <span className="truncate">{meta.join(' · ')}</span>
        {entry.homepage ? (
          <button
            type="button"
            className="store-card-link"
            // 外链交给系统浏览器：渲染层自己开窗会被主进程的导航围栏拦下（见 main/windows.ts）
            onClick={() => void window.songloft.shell.openExternal(entry.homepage)}
          >
            主页
          </button>
        ) : null}
      </div>
    </li>
  )
}

/* ─────────────────────────── 卡片网格的骨架屏 ─────────────────────────── */

/**
 * 首屏摆几张骨架卡。
 *
 * 不能拿 PAGE_SIZE（20）来摆 —— 那是「一次请求拉多少」，不是「一屏看得见多少」：
 * 12 张已经把首屏铺满还多出一点（3 列时 4 行），20 张会撑到七行；而商店里真的只有
 * 三条时，骨架摆得越长，数据回来那一刻页面缩得越狠。
 *
 * 12 这个数在常见的几档列数下都排得出整行（4×3 / 3×4 / 2×6），末行不会孤零零挂着一张。
 */
const SKELETON_CARDS = 12

/**
 * 商店卡片的骨架屏。
 *
 * ★ 它**复用 StoreCard 那一套类名**（.store-grid / .store-card / .store-card-top /
 *   .store-card-desc / .store-card-tags / .store-card-foot），而不是自己摆一套尺寸：
 *   占位块的位置因此由**同一份 CSS** 决定 —— 卡片高度、内边距、区块间距、图标尺寸
 *   天然对齐，数据回来时只是灰条换成文字。自己另写一套尺寸的话，将来改卡片样式必然
 *   忘了改这里，两者会慢慢错开；而错开的表现，正是这一屏要消掉的那种跳动。
 *
 * ★ 只有一处刻意不等真：描述那一块不论真实文本是几行，都只摆两行灰条。
 *   真实的 .store-card-desc 本来就有 min-height: 39px 兜底（见 components.css 里那段
 *   「描述固定两行的高度」），所以一条描述与两条描述的卡片一样高，骨架照这个高度摆也对得上。
 */
function StoreCardSkeleton(): React.JSX.Element {
  return (
    <li className="store-card" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <div className="store-card-top">
        {/* 图标：与 StoreIcon 那 40px 同尺寸（.store-card .plugin-icon） */}
        <div
          className="skeleton"
          style={{ flex: 'none', width: 40, height: 40, borderRadius: 8 }}
        />
        {/* 名称这一格是顶行唯一可伸缩的（.store-card-name 的 flex: 1 + min-width: 0），
            所以占位块挂在它**里面**，而不是拿灰条顶掉这一格 */}
        <span className="store-card-name">
          <div className="skeleton" style={{ height: 13, width: '58%' }} />
        </span>
        {/* 动作按钮：.btn[data-size='sm'] 是 29px 高，「安装」两个字量下来约 84 宽 */}
        <div
          className="skeleton"
          style={{ flex: 'none', width: 84, height: 29, borderRadius: 'var(--r-sm)' }}
        />
      </div>

      {/* 描述：两条灰条。行距按 .store-card-desc 的行高摆（12.5px × 1.55 ≈ 19，减掉条高 12） */}
      <div className="store-card-desc" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div className="skeleton" style={{ height: 12, width: '100%' }} />
        <div className="skeleton" style={{ height: 12, width: '62%' }} />
      </div>

      {/* 标签行：来源徽标 + entryPath 两枚。★ 两者高度**不一样**、要各按各的来：
          徽标是 .badge 的 18px，而 entryPath 那块（.store-card-code）是 11px 的字乘上
          继承来的 1.5 行高、再加它自己的上下 2px 内边距 = 20.5 —— 照着 18 摆，整行会矮
          2.5px，全店的卡片跟着矮一截 */}
      <div className="store-card-tags">
        <div className="skeleton" style={{ width: 70, height: 18, borderRadius: 'var(--r-xs)' }} />
        <div
          className="skeleton"
          style={{ width: 104, height: 20.5, borderRadius: 'var(--r-xs)' }}
        />
      </div>

      {/*
        底行。两处不显然，都是为了让外框与真实底行一样高：
        * 两段用 span 而不是 div：.store-card-foot > span 那条 `flex: 1` 正是真实底行的分栏
          方式（左边「作者 · 版本」占满、右边「主页」贴尾），用 div 就得再抄一遍；
        * minHeight 用 1lh：真实底行的高度是**文字的行盒**撑起来的（11.5px × 继承来的
          行高 1.5 ≈ 17px），灰条只有 12px —— 不把行盒补回来，每张骨架卡会矮 5px，
          数据一回来整片卡片往下长一截。写 1lh 而不是 17：字号变了它跟着变。
      */}
      <div className="store-card-foot" style={{ minHeight: '1lh' }}>
        <span className="skeleton" style={{ height: 12 }} />
        <span className="skeleton" style={{ flex: 'none', width: 26, height: 12 }} />
      </div>
    </li>
  )
}

function StoreGridSkeleton(): React.JSX.Element {
  return (
    <ul className="store-grid" aria-hidden="true">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <StoreCardSkeleton key={index} />
      ))}
    </ul>
  )
}

/**
 * 商店条目的图标。
 *
 * ★ 后端的 `icon` 字段是 **`/api/v1/proxy?url=<encoded>`** —— 服务端替我们把图标从源站
 *   取回来（顺手套上配置里的 GitHub 代理），所以它是一条**本机后端上的相对路径**，
 *   必须按资源地址拼 `baseUrl` + `access_token`（与封面同一条路：lib/url.ts 的
 *   buildResourceUrl）。它**不是** http(s) 开头的，别按「像不像外链」判断 ——
 *   那样整店都会退成首字母兜底图。
 *   （上游 Flutter 端踩过同一处：他们的判据是 `endsWith('.svg')`，而 /api/v1/proxy
 *   结尾没有 .svg，于是全部 SVG 图标被当成位图、解码失败回退首字母。）
 *
 * 取不到就退到首字母兜底（与已装插件共用 PluginIconFallback）：图标是插件作者自己打包的，
 * 404 / 坏文件是常态，留一个破图比没有图更难看出「这个插件没图标」。
 */
function StoreIcon({ entry, name }: { entry: RegistryEntry; name: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  // token 变化（重新登录）后 URL 要跟着变，否则会 401。
  // 解构出两个字符串当依赖：resourceContext() 每次返回新对象，直接依赖它会每帧重算
  const { baseUrl, accessToken } = resourceContext()
  const src = useMemo(
    () => buildResourceUrl(entry.icon, { baseUrl, accessToken }),
    [entry.icon, baseUrl, accessToken]
  )

  useEffect(() => setBroken(false), [src])

  if (src && !broken) {
    return (
      <img
        className="plugin-icon"
        src={src}
        alt=""
        width={40}
        height={40}
        onError={() => setBroken(true)}
      />
    )
  }

  return <PluginIconFallback name={name} size={40} />
}

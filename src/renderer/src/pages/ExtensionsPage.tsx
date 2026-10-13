/**
 * 插件管理 —— 扩展主框架右侧的一栏（框架与左栏见 components/ExtensionFrame.tsx）。
 *
 * 只列**已经装上的**：「还能装的」在同框架的插件商店那一栏里。装是「逛」、这是「改配置」，
 * 两种节奏各有各的一栏，而不是并排挤在同一屏里互相争宽度。
 *
 * 列表顺序就是扩展侧栏里那份顺序 —— 同一个 `order`，同一个 applyPluginOrder。
 * 两处各存一份的话，「拖完没反应」或「侧栏顺序自己变了」会随机出现。
 */

import { useEffect, useRef, useState } from 'react'

import type { ExtensionSidebarState } from '@shared/ipc'
import { entryPathsOf, pluginDisplayName, type JSPlugin } from '@shared/plugin'
import { getGithubProxy } from '@/api/endpoints'
import {
  checkPluginUpdate,
  cleanupPluginStorage,
  getPluginKeepAlive,
  setPluginKeepAlive,
  updateAllPlugins,
  updatePlugin,
  uploadPlugin,
  type PluginBatchUpdate
} from '@/api/plugins'
import { useContextMenu, type MenuItem } from '@/components/ContextMenu'
import {
  IconDownload,
  IconGrip,
  IconLoader,
  IconMore,
  IconPin,
  IconPuzzle,
  IconRefresh,
  IconSliders,
  IconTrash,
  IconUpload
} from '@/components/Icons'
import { Modal } from '@/components/Modal'
import { PluginIcon } from '@/components/PluginIcon'
import { EmptyState, Switch } from '@/components/primitives'
import { togglePlugin, uninstallPlugin } from '@/lib/plugin-actions'
import { requireClient } from '@/state/useAuth'
import { useOrderedPlugins, usePlugins } from '@/state/usePlugins'
import { useSettings } from '@/state/useSettings'
import { toast } from '@/state/useToasts'

/** 扩展侧栏的三档形态，与 shared/ipc.ts 的 ExtensionSidebarState 一一对应 */
const SIDEBAR_CHOICES: { value: ExtensionSidebarState; label: string }[] = [
  { value: 'expanded', label: '展开' },
  { value: 'collapsed', label: '折叠' },
  { value: 'hidden', label: '隐藏' }
]

export function ExtensionsPage(): React.JSX.Element {
  const ordered = useOrderedPlugins()
  const loaded = usePlugins((state) => state.loaded)
  const error = usePlugins((state) => state.error)
  const setOrder = usePlugins((state) => state.setOrder)
  const load = usePlugins((state) => state.load)

  /* 扩展侧栏的形态（展开 / 折叠 / 隐藏）。它既是「默认」也是「当前」——一个设置而已 */
  const sidebarState = useSettings((state) => state.settings.extensionSidebarState)
  const patchSettings = useSettings((state) => state.patch)

  /** 拖拽中的下标与悬停到的下标。都放本地：它们是纯粹的交互瞬时状态，不该进 store */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  /* 上传插件包 */
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  /* 全部更新 / 清理数据 */
  const [updating, setUpdating] = useState(false)
  const [updateFailure, setUpdateFailure] = useState<PluginBatchUpdate | null>(null)
  const [cleaning, setCleaning] = useState(false)
  /* 单行那颗「⋯」里正在跑的动作（检查更新 / 下载更新）—— 按下标住，同一时刻只跑一个 */
  const [busyId, setBusyId] = useState<number | null>(null)
  /**
   * 常驻白名单（entryPath 列表）。读一次只为把勾选显示出来；
   * **真正切换时会再读一次**（这个设置是整表覆盖写的，见 toggleKeepAlive 的说明）。
   * 读失败就当作「都没勾」——切换那一步自己是现读现改的，不受这份缓存影响。
   */
  const [keepAlive, setKeepAlive] = useState<string[]>([])

  useEffect(() => {
    void getPluginKeepAlive(requireClient())
      .then(setKeepAlive)
      .catch(() => undefined)
  }, [])

  const enabledCount = ordered.filter((plugin) => plugin.status === 'active').length

  /**
   * 落位后写回顺序。
   *
   * 写的是**全部已装**的序列（连停用的一起），不是只看启用的那些：只写启用的会把
   * 停用插件的位置从 order 里抹掉，用户重新启用它时它就跳到末尾了 —— 而他什么都没做。
   */
  const dropAt = (index: number): void => {
    const from = dragIndex
    setDragIndex(null)
    setOverIndex(null)
    if (from === null || from === index) return

    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(index, 0, moved)
    void setOrder(entryPathsOf(next)).catch(() => toast('扩展顺序没能保存', 'error'))
  }

  /**
   * 上传本地 `.jsplugin.zip` 安装。
   *
   * ★ 后端把「安装失败」也放在 200 的 body 里（`success: 0`），**要看 results 而不是看有没有抛** ——
   *   看状态码的话，一个包坏了会被当成装好了。
   */
  const upload = async (file: File): Promise<void> => {
    setUploadPercent(0)
    try {
      const result = await uploadPlugin(requireClient(), file, (sent, total) => {
        setUploadPercent(total > 0 ? Math.round((sent * 100) / total) : 0)
      })
      const failed = result.results.filter((item) => !item.success)
      if (result.success === 0) {
        throw new Error(failed[0]?.error || result.message || '安装失败')
      }
      toast(
        `已安装 ${result.success} 个扩展`,
        failed.length ? 'info' : 'success',
        failed.length ? `${failed.length} 个没能装上：${failed[0].error}` : undefined
      )
      // 插件列表变了 → 扩展侧栏与这一页都要跟着变
      await load()
    } catch (reason) {
      toast('上传失败', 'error', reason instanceof Error ? reason.message : undefined)
    } finally {
      setUploadPercent(null)
    }
  }

  /**
   * 全部更新。
   *
   * ★ 它更新的是**声明了远程更新源**（manifest 里的 `updateUrl`）的插件，后端对没有更新源的
   *   插件直接计入 skipped。所以「跳过 N 个」不是失败，而是那些插件没有任何可查的远端版本 ——
   *   想升级只能到插件商店里逐个装。把这句话讲出来，比一个「已更新 0 个」有用得多。
   *
   * 失败的逐条原因放不进 toast（只够一行），所以有失败时改用弹窗列清单。
   */
  const updateAll = async (): Promise<void> => {
    setUpdating(true)
    try {
      // 后端不会自己去读它存的那份代理配置；拿不到就直连，不因此放弃整次更新
      const proxy = await getGithubProxy(requireClient()).catch(() => '')
      const result = await updateAllPlugins(requireClient(), { githubProxy: proxy })
      await load()

      if (result.failed > 0) {
        setUpdateFailure(result)
        return
      }
      const summary = [`已更新 ${result.updated} 个`]
      if (result.skipped > 0) summary.push(`跳过 ${result.skipped} 个`)
      toast(
        summary.join(' · '),
        result.updated > 0 ? 'success' : 'info',
        result.skipped > 0
          ? '被跳过的是没有声明远程更新源的插件（或已是最新版）；要升级它们请到插件商店里单独装。'
          : undefined
      )
    } catch (reason) {
      toast('批量更新失败', 'error', reason instanceof Error ? reason.message : undefined)
    } finally {
      setUpdating(false)
    }
  }

  /**
   * 清理已卸载插件残留的数据。
   *
   * 破坏性且**不可恢复**，所以先问一句（与卸载同一个路子）——说的是会发生什么，不是「确定吗」。
   */
  const cleanup = async (): Promise<void> => {
    const ok = window.confirm(
      '清理已卸载插件残留的数据？这些数据属于当前没装着的插件，清理后无法恢复。'
    )
    if (!ok) return
    setCleaning(true)
    try {
      const result = await cleanupPluginStorage(requireClient())
      toast(
        result.cleaned > 0 ? `已清理 ${result.cleaned} 个插件的残留数据` : '没有需要清理的残留数据',
        result.cleaned > 0 ? 'success' : 'info'
      )
    } catch (reason) {
      toast('清理失败', 'error', reason instanceof Error ? reason.message : undefined)
    } finally {
      setCleaning(false)
    }
  }

  /**
   * 常驻运行（上游 Flutter 端 `_toggleKeepAlive` 同款：读白名单 → 增删这一条 → 整份写回）。
   *
   * ★ 写回前**重新读一次**：这个设置只有「整表读 / 整表写」两个口子（PUT `{plugins:[…]}`），
   *   拿一份可能过期的列表去覆盖，会把别处（另一台设备、另一个窗口）刚加进去的项悄悄抹掉。
   *   缓存那一份只用来画勾选，不参与这次写入。
   */
  const toggleKeepAlive = async (plugin: JSPlugin): Promise<void> => {
    const entryPath = plugin.entryPath
    if (!entryPath) return
    const name = pluginDisplayName(plugin)
    try {
      const current = await getPluginKeepAlive(requireClient())
      const pinned = current.includes(entryPath)
      const next = pinned ? current.filter((path) => path !== entryPath) : [...current, entryPath]
      setKeepAlive(await setPluginKeepAlive(requireClient(), next))
      toast(pinned ? `「${name}」不再常驻运行` : `「${name}」将常驻运行`, 'success')
    } catch (reason) {
      toast('常驻设置失败', 'error', reason instanceof Error ? reason.message : undefined)
    }
  }

  /**
   * 更新单个插件：先问后端有没有新版，有才下载（否则白等一次下载）。
   *
   * ★ 上游那一行菜单拆成「检查更新」与「强制更新」两条，这里合成一条：先查，查到新版让用户
   *   确认再装。★ `has_update=false` 也可能是「这个插件没声明远程更新源」，响应分不出来，
   *   所以文案只说「已是最新版本」（见 api/plugins.ts 的 checkPluginUpdate）。
   */
  const updateOne = async (plugin: JSPlugin): Promise<void> => {
    const name = pluginDisplayName(plugin)
    setBusyId(plugin.id)
    try {
      // 后端不会自己去读它存的那份代理配置；拿不到就直连，不因此放弃整次检查
      const proxy = await getGithubProxy(requireClient()).catch(() => '')
      const info = await checkPluginUpdate(requireClient(), plugin.id, proxy)
      if (!info.hasUpdate) {
        toast(
          `「${name}」已是最新版本`,
          'info',
          info.currentVersion ? `当前 v${info.currentVersion}` : undefined
        )
        return
      }
      const ok = window.confirm(
        `「${name}」有新版本 v${info.remoteVersion}（当前 v${info.currentVersion}），现在更新？`
      )
      if (!ok) return
      await updatePlugin(requireClient(), plugin.id, { githubProxy: proxy })
      // 后端已经顺手把它重载过了，这里只要把列表刷新到新版本号
      await load()
      toast(`「${name}」已更新到 v${info.remoteVersion}`, 'success')
    } catch (reason) {
      toast('更新失败', 'error', reason instanceof Error ? reason.message : undefined)
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 停用/启用与卸载都走 `lib/plugin-actions`：标题栏那颗扩展下拉里也能做同样两件事，
   * 各写一份的话「卸载会连数据一起删」那句确认迟早有一处会漏。
   */

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <IconSliders size={24} />
            插件管理
          </h1>
          <p className="page-subtitle">
            {loaded
              ? `${ordered.length} 个已安装 · ${enabledCount} 个启用中 · 拖动可调整扩展侧栏里的顺序`
              : '正在读取…'}
          </p>
        </div>
      </div>

      {/*
        扩展侧栏的形态。★ 放在这一页而不是「设置」里：它管的是**扩展主框架自己的侧栏**，
        与扩展的其它配置在一处更顺。更要紧的是 —— 侧栏被隐藏之后，这里是**唯一**能改回来的
        地方（侧栏上那颗收起按钮随侧栏一起没了），所以那句话也要写出来。
      */}
      <div className="frame-setting">
        <span>扩展侧栏</span>
        <div className="segmented" role="group" aria-label="扩展侧栏显示方式">
          {SIDEBAR_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={sidebarState === choice.value}
              onClick={() => void patchSettings({ extensionSidebarState: choice.value })}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {sidebarState === 'hidden' ? (
          <span className="field-hint">已隐藏；随时可从标题栏的「扩展」菜单回到本页改回来</span>
        ) : null}

        {/* 四个动作与上面那行「扩展侧栏 + 三档选择」**同一行**（靠右，见
            .frame-setting-actions）：它们都是「这一页怎么摆」这一档的操作，各占一层
            会把页头撑成两段。顺序照「改这一本机 → 动远端 → 收尾」排；重新读取只是个
            图标按钮，它是查错用的，不该跟三个真实动作抢同一行位置 */}
        <div className="row frame-setting-actions">
          <button
            type="button"
            className="icon-btn"
            data-tip="重新读取已安装列表"
            aria-label="重新读取已安装列表"
            onClick={() => void load().catch(() => toast('扩展列表刷新失败', 'error'))}
          >
            <IconRefresh size={15} />
          </button>

          <button
            type="button"
            className="btn"
            data-size="sm"
            disabled={uploadPercent !== null}
            onClick={() => fileRef.current?.click()}
          >
            {uploadPercent === null ? <IconUpload size={14} /> : <IconLoader size={14} />}
            {uploadPercent === null ? '上传插件' : `上传中 ${uploadPercent}%`}
          </button>

          <button
            type="button"
            className="btn"
            data-size="sm"
            disabled={updating || ordered.length === 0}
            onClick={() => void updateAll()}
          >
            {updating ? <IconLoader size={14} /> : <IconDownload size={14} />}
            全部更新
          </button>

          <button
            type="button"
            className="btn"
            data-size="sm"
            disabled={cleaning}
            onClick={() => void cleanup()}
          >
            {cleaning ? <IconLoader size={14} /> : <IconTrash size={14} />}
            清理数据
          </button>
        </div>

        {/* 选文件必须由点击直接触发，所以这个 input 一直挂着、只是看不见 */}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".zip"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // 清空 value：同一个文件再选一次也要能触发 change（否则第二次毫无反应）
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </div>

      {!loaded && !error ? (
        <div className="empty">
          <IconLoader size={22} />
        </div>
      ) : null}

      {error ? (
        <EmptyState
          icon={<IconPuzzle size={26} />}
          title="扩展列表打不开"
          description={error}
          action={
            <button
              type="button"
              className="btn"
              data-size="sm"
              onClick={() => void load().catch(() => undefined)}
            >
              重试
            </button>
          }
        />
      ) : null}

      {loaded && !error && ordered.length === 0 ? (
        <EmptyState
          icon={<IconPuzzle size={26} />}
          title="还没有安装扩展"
          description="左侧「插件商店」里能直接装；也可以装本地打包好的 .jsplugin.zip。"
        />
      ) : null}

      {loaded && !error && ordered.length > 0 ? (
        <ul className="extension-list">
          {ordered.map((plugin, index) => (
            <ExtensionRow
              key={plugin.id}
              plugin={plugin}
              dragging={dragIndex === index}
              // 拖到自己头上不算落点，否则会画出一条毫无意义的指示线
              over={overIndex === index && dragIndex !== null && dragIndex !== index}
              pinned={keepAlive.includes(plugin.entryPath)}
              busy={busyId === plugin.id}
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => setOverIndex(index)}
              onDrop={() => dropAt(index)}
              onDragEnd={() => {
                setDragIndex(null)
                setOverIndex(null)
              }}
              onToggle={(next) => togglePlugin(plugin, next)}
              onToggleKeepAlive={() => void toggleKeepAlive(plugin)}
              onUpdate={() => void updateOne(plugin)}
              onUninstall={() => uninstallPlugin(plugin)}
            />
          ))}
        </ul>
      ) : null}

      {/* 批量更新的失败清单。逐条原因塞不进 toast（那里只有一行），而「哪个插件为什么没升上去」
          正是用户要的东西 —— 尤其是「下载失败」这类需要他自己去看网络/源的 */}
      {updateFailure ? (
        <Modal
          title="部分扩展没能更新"
          onClose={() => setUpdateFailure(null)}
          footer={
            <button type="button" className="btn" onClick={() => setUpdateFailure(null)}>
              知道了
            </button>
          }
        >
          <p className="field-hint">
            共 {updateFailure.total} 个：更新 {updateFailure.updated} 个 · 失败{' '}
            {updateFailure.failed} 个 · 跳过 {updateFailure.skipped} 个。以下是失败的原因。
          </p>
          <ul className="extension-list">
            {updateFailure.results
              .filter((item) => !item.success && item.error)
              .map((item) => (
                <li className="extension-row" key={item.entryPath || item.pluginId}>
                  <div className="extension-info">
                    <div className="extension-name">
                      {item.pluginName || item.entryPath}
                      {item.currentVersion ? (
                        <span className="badge">本机 v{item.currentVersion}</span>
                      ) : null}
                    </div>
                    <div className="extension-meta">{item.error}</div>
                  </div>
                </li>
              ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────── 单行 ─────────────────────────────── */

interface ExtensionRowProps {
  plugin: JSPlugin
  dragging: boolean
  over: boolean
  /** 这个插件在常驻白名单里（行内菜单里那一项的勾） */
  pinned: boolean
  /** 这一行有动作在跑（检查 / 下载更新）：菜单入口换成转圈并按住 */
  busy: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onToggle: (next: boolean) => void
  onToggleKeepAlive: () => void
  onUpdate: () => void
  onUninstall: () => void
}

function ExtensionRow({
  plugin,
  dragging,
  over,
  pinned,
  busy,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onToggleKeepAlive,
  onUpdate,
  onUninstall
}: ExtensionRowProps): React.JSX.Element {
  const name = pluginDisplayName(plugin)
  const enabled = plugin.status === 'active'
  // 版本号不在这里（它挪到名字右边当标签了），所以这一行只剩作者与说明，可能整个是空的
  const meta = [plugin.author, plugin.description].filter(Boolean).join(' · ')
  const menuRef = useRef<HTMLButtonElement>(null)
  // 只为把 aria-expanded 说准：读宿主的真实状态，不另存一份「我开着」（与标题栏那两颗一致）
  const menuOpen = useContextMenu((state) => state.open && state.anchor === menuRef.current)

  /**
   * 行尾那颗「⋯」。
   *
   * 三条与上游 Flutter 端的行内菜单（PopupMenuButton）对齐：常驻运行（push_pin，选中打勾）、
   * 更新、删除。那边把更新拆成「检查更新」与「强制更新」两条，这里合成一条「先查后更」；
   * 删除放在分割线之下、走 danger 色 —— 它是这一行里唯一不可逆的动作。
   */
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const menu = useContextMenu.getState()
    // 宿主对「点触发器」刻意不关（anchor 放行），所以这里读到的仍是开着 → 收起
    if (menu.open) {
      menu.hide()
      return
    }
    const items: MenuItem[] = [
      {
        key: 'keep-alive',
        label: '常驻运行',
        icon: <IconPin size={16} />,
        // 给出 checked 会让整层面板切成「带勾位列」的排版 —— 正合适
        checked: pinned,
        disabled: busy,
        onClick: onToggleKeepAlive
      },
      {
        key: 'update',
        label: '更新',
        icon: <IconDownload size={16} />,
        disabled: busy,
        onClick: onUpdate
      },
      { key: 'menu-sep', label: '', separator: true },
      {
        key: 'delete',
        label: '删除',
        icon: <IconTrash size={16} />,
        variant: 'danger',
        disabled: busy,
        onClick: onUninstall
      }
    ]
    const rect = event.currentTarget.getBoundingClientRect()
    // 右对齐：这颗按钮长在行尾，左对齐会让面板越出行外
    menu.show(rect.left, rect.bottom + 6, items, {
      anchor: event.currentTarget,
      align: 'right',
      anchorRect: rect
    })
  }

  return (
    <li
      className="extension-row"
      data-dragging={dragging ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-enabled={enabled ? 'true' : 'false'}
      // 整行可拖：抓手只是个提示 —— 只让抓手能拖的话，用户十有八九会去拽行本身，
      // 然后发现拖不动，再怀疑这个功能坏了
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        // 不 preventDefault 的话浏览器会拒绝这个落点，onDrop 根本不触发
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
    >
      <span className="extension-grip" aria-hidden="true">
        <IconGrip size={16} />
      </span>

      <PluginIcon plugin={plugin} size={34} />

      <div className="extension-info">
        <div className="extension-name">
          {/* 名字长了出省略号，右侧那几枚标签一律不许被挤扁（见 .extension-name 那两条规则） */}
          <span className="truncate">{name}</span>
          {/*
            版本号是一枚**灰底标签**，紧挨着名字。
            它原先混在下面那行「作者 · 说明」里 —— 一串说明文字中间的一个版本号根本认不出来，
            而「这一页里哪个扩展是哪个版本」正是扫列表时最要比的东西。
            没有版本号时兜一枚「—」：凭空少一枚标签，看着像没加载出来。
          */}
          <span className="badge">v{plugin.version || '—'}</span>
          {plugin.status === 'error' ? (
            // 「运行异常」不是坏了：后端在指数退避重试，入口位上暂时不出现
            <span className="badge" data-tone="warning">
              运行异常
            </span>
          ) : null}
        </div>
        {/* 版本号搬去了名字那一行，这里只剩作者与说明；两者都没有时整行不渲染 ——
            否则会留一道空行，把行高撑得比有说明的那些还高 */}
        {meta ? <div className="extension-meta truncate">{meta}</div> : null}
      </div>

      <Switch checked={enabled} onChange={onToggle} ariaLabel={`启用 ${name}`} />

      <button
        ref={menuRef}
        type="button"
        className="icon-btn"
        data-tip="更多操作"
        aria-label={`${name} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={toggleMenu}
      >
        {busy ? <IconLoader size={16} /> : <IconMore size={16} />}
      </button>
    </li>
  )
}

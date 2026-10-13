/**
 * 插件管理 —— 扩展主框架右侧的一栏（框架与左栏见 components/ExtensionFrame.tsx）。
 *
 * 只列**已经装上的**：「还能装的」在同框架的插件商店那一栏里。装是「逛」、这是「改配置」，
 * 两种节奏各有各的一栏，而不是并排挤在同一屏里互相争宽度。
 *
 * 列表顺序就是扩展侧栏里那份顺序 —— 同一个 `order`，同一个 applyPluginOrder。
 * 两处各存一份的话，「拖完没反应」或「侧栏顺序自己变了」会随机出现。
 */

import { useRef, useState } from 'react'

import { entryPathsOf, pluginDisplayName, type JSPlugin } from '@shared/plugin'
import { getGithubProxy } from '@/api/endpoints'
import {
  cleanupPluginStorage,
  updateAllPlugins,
  uploadPlugin,
  type PluginBatchUpdate
} from '@/api/plugins'
import {
  IconDownload,
  IconGrip,
  IconLoader,
  IconPuzzle,
  IconRefresh,
  IconSliders,
  IconTrash,
  IconUpload
} from '@/components/Icons'
import { Modal } from '@/components/Modal'
import { PluginIcon } from '@/components/PluginIcon'
import { EmptyState, Switch } from '@/components/primitives'
import { requireClient } from '@/state/useAuth'
import { useOrderedPlugins, usePlugins } from '@/state/usePlugins'
import { toast } from '@/state/useToasts'

export function ExtensionsPage(): React.JSX.Element {
  const ordered = useOrderedPlugins()
  const loaded = usePlugins((state) => state.loaded)
  const error = usePlugins((state) => state.error)
  const setOrder = usePlugins((state) => state.setOrder)
  const setEnabled = usePlugins((state) => state.setEnabled)
  const remove = usePlugins((state) => state.remove)
  const load = usePlugins((state) => state.load)

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

  const toggle = (plugin: JSPlugin, next: boolean): void => {
    void setEnabled(plugin.id, next)
      .then(() =>
        toast(next ? `已启用「${pluginDisplayName(plugin)}」` : '已停用该扩展', 'success')
      )
      .catch((reason: unknown) =>
        toast('操作失败', 'error', reason instanceof Error ? reason.message : undefined)
      )
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
   * 卸载。
   *
   * 用 window.confirm 而不是自绘弹窗：仓库里所有破坏性确认都是这个路子（见
   * PlaylistsPage / SettingsPage）。它说的是**会发生什么**而不是「确定吗」——
   * 卸载会连插件的磁盘数据一起清掉，这一点必须讲明白。
   */
  const uninstall = (plugin: JSPlugin): void => {
    const name = pluginDisplayName(plugin)
    if (!window.confirm(`卸载「${name}」？插件在本机留下的数据会一并删除，不可恢复。`)) return
    void remove(plugin.id)
      .then(() => toast(`已卸载「${name}」`, 'success'))
      .catch((reason: unknown) =>
        toast('卸载失败', 'error', reason instanceof Error ? reason.message : undefined)
      )
  }

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

        {/* 四个动作按「改这一本机 → 动远端 → 收尾」排；重新读取只是个图标按钮，
            它是查错用的，不该跟三个真实动作抢同一行位置 */}
        <div className="row">
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
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => setOverIndex(index)}
              onDrop={() => dropAt(index)}
              onDragEnd={() => {
                setDragIndex(null)
                setOverIndex(null)
              }}
              onToggle={(next) => toggle(plugin, next)}
              onUninstall={() => uninstall(plugin)}
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
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onToggle: (next: boolean) => void
  onUninstall: () => void
}

function ExtensionRow({
  plugin,
  dragging,
  over,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onUninstall
}: ExtensionRowProps): React.JSX.Element {
  const name = pluginDisplayName(plugin)
  const enabled = plugin.status === 'active'

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
          {name}
          {plugin.status === 'error' ? (
            // 「运行异常」不是坏了：后端在指数退避重试，入口位上暂时不出现
            <span className="badge" data-tone="warning">
              运行异常
            </span>
          ) : null}
        </div>
        <div className="extension-meta truncate">
          {[`v${plugin.version || '—'}`, plugin.author, plugin.description]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      <Switch checked={enabled} onChange={onToggle} ariaLabel={`启用 ${name}`} />

      <button
        type="button"
        className="icon-btn"
        data-tip="卸载"
        aria-label={`卸载 ${name}`}
        onClick={onUninstall}
      >
        <IconTrash size={16} />
      </button>
    </li>
  )
}

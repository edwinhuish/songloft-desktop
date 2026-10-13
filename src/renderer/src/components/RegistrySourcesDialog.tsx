/**
 * 「管理订阅源」对话框 —— 扩展商店里的列表从哪些源来。
 *
 * 后端只有「整表读 / 整表写」两个口子（`GET|PUT /settings/plugin-registries`），没有单条
 * 增删改，所以这里就是一张**草稿表**：所有编辑都先在本地改，点保存才整份 PUT 回去。
 * 于是「删一个源」= 保存时不带它、「停用」= `enabled: false`、「改地址」= 换掉那一行的 url。
 *
 * 两条必须让用户看见的语义（都写进了界面文案，不然很容易踩）：
 *   1. **地址就是身份**（后端没有 id，按 URL 匹配来源、按 URL 查它自己的 token），
 *      所以改地址在效果上等于「删掉旧源、新增一个源」，重复地址也必须拦住；
 *   2. **Token 非空 = 私有源**：该源的条目下载时走 `Authorization: Bearer`。
 *      单源筛选时这个 token 还要由商店一起带过去（后端在单源模式下不会去读已保存的配置）。
 */

import { useCallback, useEffect, useState } from 'react'

import { getPluginRegistries, updatePluginRegistries, type RegistrySource } from '@/api/plugins'
import { IconAlert, IconLoader, IconPlus, IconStore, IconTrash } from './Icons'
import { Modal } from './Modal'
import { Switch } from './primitives'
import { useAuth } from '@/state/useAuth'
import { toast } from '@/state/useToasts'

export interface RegistrySourcesDialogProps {
  onClose: () => void
  /**
   * 保存成功。
   *
   * 商店那份列表此刻已经过期了：源的增删改都会让聚合结果变（后端也会顺手作废它的缓存），
   * 所以调用方要重拉一次，而不是把旧的留在屏幕上。
   */
  onSaved: () => void
}

/** 地址必须是 http(s)：后端要拿它去 fetch，别的写法只会得到一条「拉取注册表失败」 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** 保存前的整表检查。返回第一处问题（没有则 null）——一次只说一条，说了就改，不必看清单 */
function findProblem(sources: RegistrySource[]): string | null {
  const seen = new Set<string>()
  for (const source of sources) {
    const url = source.url.trim()
    if (!isHttpUrl(url)) {
      return `「${source.name.trim() || '未命名'}」的地址要以 http:// 或 https:// 开头`
    }
    if (seen.has(url)) return `地址重复：${url}`
    seen.add(url)
  }
  return null
}

export function RegistrySourcesDialog({
  onClose,
  onSaved
}: RegistrySourcesDialogProps): React.JSX.Element {
  const client = useAuth((state) => state.client)
  /** null = 还在读；读到之后即便是空数组也代表「一个源都没有」 */
  const [sources, setSources] = useState<RegistrySource[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 校验 / 保存失败的原因，显示在列表上方 */
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('')

  const load = useCallback((): void => {
    if (!client) return
    setSources(null)
    setLoadError(null)
    getPluginRegistries(client)
      .then(setSources)
      .catch((reason: unknown) => {
        setLoadError(reason instanceof Error ? reason.message : '订阅源读取失败')
      })
  }, [client])

  useEffect(() => {
    load()
  }, [load])

  const patchAt = (index: number, next: Partial<RegistrySource>): void => {
    setProblem(null)
    setSources((list) =>
      list ? list.map((source, i) => (i === index ? { ...source, ...next } : source)) : list
    )
  }

  const removeAt = (index: number): void => {
    setProblem(null)
    setSources((list) => (list ? list.filter((_, i) => i !== index) : list))
  }

  /**
   * 新增一行。
   *
   * 不做「先加一行空白行再填」：空白行既是校验的麻烦，也会在列表里留下半截状态。
   * 地址先在这里校验一次，不合格就地拦下 —— 用户这时还看得见自己刚敲进去的东西。
   */
  const addDraft = (): void => {
    const url = draftUrl.trim()
    if (!isHttpUrl(url)) {
      setProblem('订阅源地址要以 http:// 或 https:// 开头')
      return
    }
    if (sources?.some((source) => source.url.trim() === url)) {
      setProblem('这个地址已经在列表里了：地址是订阅源的身份，不能重复')
      return
    }
    setSources([...(sources ?? []), { url, name: draftName.trim(), enabled: true, token: '' }])
    setDraftName('')
    setDraftUrl('')
    setProblem(null)
  }

  const save = (): void => {
    if (!client || !sources) return
    const found = findProblem(sources)
    if (found) {
      setProblem(found)
      return
    }

    // 整表 PUT 之前统一 trim：地址前后带空格是最常见的粘贴事故，而后端会拿它当身份比对
    const cleaned = sources.map((source) => ({
      url: source.url.trim(),
      name: source.name.trim(),
      enabled: source.enabled,
      token: source.token.trim()
    }))

    setSaving(true)
    setProblem(null)
    updatePluginRegistries(client, cleaned)
      .then((saved) => {
        onSaved()
        toast(`已保存 ${saved.length} 个订阅源`, 'success')
        onClose()
      })
      .catch((reason: unknown) => {
        setProblem(reason instanceof Error ? reason.message : '订阅源保存失败')
      })
      .finally(() => setSaving(false))
  }

  const body = (): React.ReactNode => {
    if (loadError) {
      return (
        <>
          <div className="probe-result" data-state="error">
            <IconAlert size={15} />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            className="btn"
            data-size="sm"
            onClick={load}
            style={{ alignSelf: 'flex-start' }}
          >
            重试
          </button>
        </>
      )
    }

    if (!sources) {
      return (
        <div className="empty">
          <IconLoader size={22} />
        </div>
      )
    }

    return (
      <>
        {problem ? (
          <div className="probe-result" data-state="error">
            <IconAlert size={15} />
            <span>{problem}</span>
          </div>
        ) : null}

        {sources.length === 0 ? (
          <div className="probe-result">
            <IconStore size={15} />
            <span>一个订阅源都没有 —— 插件商店会是空的。在下面填一个地址加进来。</span>
          </div>
        ) : null}

        {sources.map((source, index) => (
          /**
           * key 用**下标**而不是 url：这里每一行都是「位置上的那一行」（顺序即聚合优先级、
           * url 是随打随变的草稿）。用 url 当 key 的话，地址输入框里每敲一个字符都会换一次
           * key，React 于是卸载重建整个输入框 —— 焦点和光标位置全丢，一个字都打不进去。
           */
          <div className="source-row" key={index}>
            <Switch
              checked={source.enabled}
              ariaLabel={`启用 ${source.name || source.url}`}
              onChange={(next) => patchAt(index, { enabled: next })}
            />

            <div className="source-fields">
              <input
                className="input"
                value={source.name}
                placeholder="名称（可留空）"
                spellCheck={false}
                aria-label="订阅源名称"
                onChange={(event) => patchAt(index, { name: event.target.value })}
              />
              <input
                className="input"
                value={source.url}
                placeholder="订阅源地址，如 https://example.com/registry.json"
                spellCheck={false}
                aria-label="订阅源地址"
                onChange={(event) => patchAt(index, { url: event.target.value })}
              />
              <input
                className="input"
                value={source.token}
                placeholder="私有源 Token（公开源留空）"
                spellCheck={false}
                autoComplete="off"
                aria-label="订阅源 Token"
                onChange={(event) => patchAt(index, { token: event.target.value })}
              />
            </div>

            <button
              type="button"
              className="icon-btn"
              data-tip="移除这个源"
              aria-label={`移除 ${source.name || source.url}`}
              onClick={() => removeAt(index)}
            >
              <IconTrash size={16} />
            </button>
          </div>
        ))}

        <div className="source-add">
          <input
            className="input"
            value={draftName}
            placeholder="新源的名称（可留空）"
            spellCheck={false}
            aria-label="新订阅源名称"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <input
            className="input"
            value={draftUrl}
            placeholder="新源的地址，如 https://example.com/registry.json"
            spellCheck={false}
            aria-label="新订阅源地址"
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              // 回车=添加：这一行本来就是「填完就走」，再挪去点按钮是多余的一步
              if (event.key === 'Enter') addDraft()
            }}
          />
          <button type="button" className="btn" data-size="sm" onClick={addDraft}>
            <IconPlus size={14} />
            添加
          </button>
        </div>

        <p className="field-hint">
          地址就是这个源的身份（后端靠它匹配条目、查它自己的 Token），改地址等于换一个源。 Token
          非空的源按私有源处理：它的条目下载时会带上 Bearer 认证。
        </p>
      </>
    )
  }

  return (
    <Modal
      title="管理订阅源"
      size="wide"
      onClose={onClose}
      // 这是一张没保存就白填的表单，点遮罩关掉太容易误伤
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={saving || !sources}
            onClick={save}
          >
            {saving ? <IconLoader size={15} /> : null}
            保存
          </button>
        </>
      }
    >
      {body()}
    </Modal>
  )
}

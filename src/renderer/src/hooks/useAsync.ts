/** 通用异步数据 hook：一次性拉取 + 手动刷新 + 卸载安全 + 切回页面时的静默刷新 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { sameData } from '@shared/data'
import { useLibrary } from '@/state/useLibrary'
import { usePageActive } from './usePageActive'

export interface AsyncResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * @param factory 数据加载函数；必须用 useCallback 包（否则会无限循环）
 * @param deps 依赖变化时自动重跑
 */
export function useAsync<T>(factory: () => Promise<T>, deps: readonly unknown[]): AsyncResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const generation = useRef(0)
  /*
   * 曲库数据的版本号（扫描 / 刷新元数据结束后 +1，见 state/useLibrary）。
   *
   * 挂在这里、而不是让每个调用方自己往 deps 里加：这些 useAsync 拉的基本都是服务端曲库
   * 数据（歌曲列表、分面、文件夹、歌单详情、首页统计…），「曲库变了就重取」是它们的
   * **公共语义** —— 散到十几处去加，迟早漏掉一处，而漏掉的那处就是一处陈旧。
   */
  const revision = useLibrary((s) => s.revision)
  /*
   * 所在的页面槽是不是看得见的那一页（见 usePageActive）。切回来时它从 false 变 true，
   * 下面那个 effect 跟着重跑 —— 于是「切回页面自动刷新」落在这里，不必每个页面各接一次。
   */
  const active = usePageActive()

  /** 手头这份数据的镜像：静默刷新要拿它比对（effect 闭包里的 state 是过期的那一份） */
  const dataRef = useRef<T | null>(null)
  /**
   * 上一次请求的「条件指纹」（依赖 + 手动刷新 + 曲库版本号）。
   * 这次与上次相同 → 只因切回本页而重跑，走**静默**路径：不显示加载态，结果一样就什么都不做。
   */
  const lastKey = useRef<string | null>(null)

  const depsKey = JSON.stringify(deps)

  useEffect(() => {
    // 页面被藏起来（切去了别的页、或去了扩展面）时不发请求：没人看，白跑一趟
    if (!active) return

    const key = JSON.stringify([depsKey, nonce, revision])
    const silent = key === lastKey.current
    lastKey.current = key
    const current = ++generation.current

    if (!silent) {
      setLoading(true)
      setError(null)
    }

    factory()
      .then((result) => {
        if (current !== generation.current) return
        // 取回来了就先清掉可能残留的错误提示：数据是好的，那条红字不该继续挂着
        setError(null)
        // 静默刷新且数据一模一样：连 setData 都不做 —— 滚动位置、展开态、页内筛选原样留着
        if (silent && sameData(dataRef.current, result)) return
        dataRef.current = result
        setData(result)
      })
      .catch((err: unknown) => {
        if (current !== generation.current) return
        // 静默刷新失败不冒泡到界面上：手头这份还能用，下次切回来再试（不该为一次后台动作弹红字）
        if (silent) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (current !== generation.current) return
        setLoading(false)
      })

    return () => {
      // 依赖变了、失活或组件卸载：让在途响应作废，避免旧数据覆盖新数据
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, depsKey, nonce, revision])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

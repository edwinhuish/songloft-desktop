/** 通用异步数据 hook：一次性拉取 + 手动刷新 + 卸载安全 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { useLibrary } from '@/state/useLibrary'

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

  useEffect(() => {
    const current = ++generation.current
    setLoading(true)
    setError(null)

    factory()
      .then((result) => {
        if (current !== generation.current) return
        setData(result)
      })
      .catch((err: unknown) => {
        if (current !== generation.current) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (current !== generation.current) return
        setLoading(false)
      })

    return () => {
      // 依赖变了或组件卸载：让在途响应作废，避免旧数据覆盖新数据
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, revision])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

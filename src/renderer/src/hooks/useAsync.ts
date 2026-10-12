/** 通用异步数据 hook：一次性拉取 + 手动刷新 + 卸载安全 */

import { useCallback, useEffect, useRef, useState } from 'react'

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
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

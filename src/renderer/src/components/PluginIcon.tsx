/**
 * 扩展图标。
 *
 * 两条容易做错的地方：
 *   1. 图标地址是 `/api/v1/jsplugin/{entryPath}/static/{icon}` —— 这条路由**不需要认证**，
 *      所以不要像封面那样去拼 `?access_token=`。拼了也不报错，只是白带一个凭据进日志。
 *   2. 图标是插件作者自己打包的，404 / 坏文件是常态。必须在 `<img>` 的 onError 上退到
 *      兜底，而不是留一个破图 —— 破图比没有图更难看出「这个插件没图标」。
 */

import { useEffect, useState } from 'react'

import { pluginDisplayName, pluginFallbackHue, pluginIconPath, type JSPlugin } from '@shared/plugin'
import { useAuth } from '@/state/useAuth'

export interface PluginIconProps {
  plugin: JSPlugin
  size: number
}

export function PluginIcon({ plugin, size }: PluginIconProps): React.JSX.Element {
  const baseUrl = useAuth((state) => state.baseUrl)
  const [broken, setBroken] = useState(false)

  // 换了插件就给它一次机会：共用同一个组件实例时，上一个插件的 404 不该传染给下一个
  useEffect(() => setBroken(false), [plugin.entryPath, plugin.icon])

  const path = pluginIconPath(plugin)
  if (path && baseUrl && !broken) {
    return (
      <img
        className="plugin-icon"
        src={`${baseUrl.replace(/\/+$/, '')}${path}`}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
      />
    )
  }

  const name = pluginDisplayName(plugin)
  return (
    <span
      className="plugin-icon plugin-icon-fallback"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.6),
        // 色相由名字派生：同一个插件在哪台设备、重装几次都还是同一个颜色
        background: `hsl(${pluginFallbackHue(name)} 58% 46%)`
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * 扩展图标。
 *
 * 两条容易做错的地方：
 *   1. 图标地址是 `/api/v1/jsplugin/{entryPath}/static/{icon}` —— 这条路由**不需要认证**
 *      （见 songloft 服务端 jsplugin/routes.go 的 RegisterStaticRoutes），所以不要像封面
 *      那样去拼 `?access_token=`。拼了也不报错，只是白带一个凭据进日志。
 *   2. 图标是插件作者自己打包的，404 / 坏文件是常态。必须在 `<img>` 的 onError 上退到
 *      兜底，而不是留一个破图 —— 破图比没有图更难看出「这个插件没图标」。
 *
 * ★ 这里只管**已安装插件**那一种图标（后端契约：`icon` 是 static/ 下的裸文件名）。
 *   商店条目的 icon 形态完全不同（服务端代理出来的路径，还要带 token），见 PluginStore
 *   里的 StoreIcon —— 两处的 URL 规则不要互相套用。
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

  return <PluginIconFallback name={pluginDisplayName(plugin)} size={size} />
}

/**
 * 没有图标（或图标取不到）时那颗首字母方块。
 *
 * 单独拎出来给**商店条目**共用：那边走的是另一条 URL 规则，但「取不到就显示什么」
 * 必须是同一套观感 —— 各写一份，改配色时就会只改到一处。
 */
export function PluginIconFallback({
  name,
  size
}: {
  name: string
  size: number
}): React.JSX.Element {
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

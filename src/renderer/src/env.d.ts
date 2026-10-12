/// <reference types="vite/client" />

import type { SongloftBridge } from '@shared/bridge'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入；渲染层唯一的系统能力入口 */
    songloft: SongloftBridge
  }
}

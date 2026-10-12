import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * 单测只覆盖 `src/shared` 里的纯函数（歌词解析、URL 拼装、格式化）。
 * 这些模块刻意不 import electron / DOM，所以不需要任何环境垫片。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})

/** 轻量提示条（替代 Flutter 端的 SnackBar/Toast） */

import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  /** 可选的一行补充说明（错误详情） */
  detail?: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone, detail?: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info', detail) => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, message, tone, detail }] }))
    const ttl = tone === 'error' ? 6500 : 3200
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, ttl)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

/** 非组件上下文（store 内部、事件回调）里也能弹提示 */
export function toast(message: string, tone: ToastTone = 'info', detail?: string): void {
  useToasts.getState().push(message, tone, detail)
}

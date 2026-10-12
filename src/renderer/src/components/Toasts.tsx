/** 提示条宿主 */

import { useToasts } from '@/state/useToasts'
import { IconAlert, IconCheck, IconInfo } from './Icons'

export function Toasts(): React.JSX.Element | null {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} onClick={() => dismiss(t.id)}>
          <span className="toast-icon">
            {t.tone === 'success' ? <IconCheck size={16} /> : t.tone === 'error' ? <IconAlert size={16} /> : <IconInfo size={16} />}
          </span>
          <span className="grow">
            <div>{t.message}</div>
            {t.detail ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 2 }}>{t.detail}</div>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 模态框：portal 到 body，Esc 关闭，锁滚动 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { IconClose } from './Icons'

export interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'normal' | 'wide'
  /** 点遮罩是否关闭（表单类对话框建议关掉，避免误触丢失输入） */
  closeOnBackdrop?: boolean
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'normal',
  closeOnBackdrop = true
}: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="overlay"
      onPointerDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" data-size={size} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}

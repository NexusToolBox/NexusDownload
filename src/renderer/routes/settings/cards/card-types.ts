import type { ReactNode } from 'react'
export interface SettingsCardDialogProps {
  open: boolean
  onClose: () => void
  labelKey: string
  descKey: string
  advancedContent?: ReactNode
}

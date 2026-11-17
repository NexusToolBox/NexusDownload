import { createContext, type ReactNode } from 'react'

export const ImmediateSettingsContext = createContext(false)
export function ImmediateSettings({ children }: { children: ReactNode }) {
  return (
    <ImmediateSettingsContext value={true}>{children}</ImmediateSettingsContext>
  )
}

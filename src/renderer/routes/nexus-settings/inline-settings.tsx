import type { ReactNode } from 'react'
export function InlineSettings({
  children,
}: {
  children?: ReactNode
  open?: boolean
  onOpenChange?: unknown
}) {
  return <div className="nx-inline-settings">{children}</div>
}
export function InlineContent({
  children,
}: {
  children?: ReactNode
  className?: string
  initialFocus?: unknown
  showCloseButton?: boolean
}) {
  return <>{children}</>
}
export function InlineHeader(_props: {
  children?: ReactNode
  className?: string
}) {
  return null
}
export function InlineTitle({
  children,
}: {
  children?: ReactNode
  className?: string
}) {
  return <h3>{children}</h3>
}
export function InlineDescription(_props: {
  children?: ReactNode
  className?: string
}) {
  return null
}
export function InlineFooter({
  children,
}: {
  children?: ReactNode
  className?: string
}) {
  return <div className="nx-inline-footer">{children}</div>
}

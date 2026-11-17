export { buttonVariants } from '@renderer/components/ui/button'

import { SettingChoice } from '@renderer/components/settings-kit/setting-choice'
import { Button as BaseButton } from '@renderer/components/ui/button'
import { Input as BaseInput } from '@renderer/components/ui/input'
import { Switch as BaseSwitch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import type { ComponentProps, ReactNode } from 'react'
import './nexus-kit.css'

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, 'variant'> & {
  variant?:
    | 'primary'
    | 'secondary'
    | 'quiet'
    | 'danger'
    | 'default'
    | 'outline'
    | 'ghost'
    | 'destructive'
    | 'link'
}
export function Button({
  variant = 'secondary',
  className,
  size,
  ...props
}: ButtonProps) {
  const aliases: Record<string, string> = {
    default: 'primary',
    outline: 'secondary',
    ghost: 'quiet',
    destructive: 'danger',
    link: 'quiet',
  }
  const tone = /(?:^|\s)(?:ink|primary)(?:\s|$)/.test(
    typeof className === 'string' ? className : ''
  )
    ? 'primary'
    : (aliases[variant] ?? variant)
  return (
    <BaseButton
      {...props}
      size={size}
      variant="ghost"
      data-nexus="button"
      data-tone={tone}
      className={cn(
        'nx-button',
        size?.startsWith('icon') && 'nx-icon-button',
        className
      )}
    />
  )
}
export function IconButton(
  props: Omit<ButtonProps, 'size'> & { 'aria-label': string }
) {
  return <Button variant="quiet" {...props} size="icon-sm" />
}
export function Section({
  title,
  description,
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <section {...props} className={cn('nx-section', className)}>
      {(title || action) && (
        <div className="nx-section-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <div className="nx-section-action">{action}</div>
        </div>
      )}
      {children}
    </section>
  )
}
export function Group({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('nx-group', className)} />
}
export function Item({
  title,
  label,
  description,
  lead,
  children,
  className,
  sub,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode
  label?: ReactNode
  description?: ReactNode
  lead?: ReactNode
  sub?: boolean
}) {
  return (
    <div {...props} className={cn('nx-item', sub && 'nx-item-sub', className)}>
      {title || label || lead ? (
        <>
          {lead && <div className="nx-item-lead">{lead}</div>}
          <div className="nx-item-body">
            <div className="nx-item-title">{title ?? label}</div>
            {description && (
              <div className="nx-item-description">{description}</div>
            )}
          </div>
          <div className="nx-item-trail">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  )
}
export function Status({
  tone = 'ok',
  children,
  label,
}: {
  tone?: 'ok' | 'warn' | 'error' | 'off' | 'live'
  children?: ReactNode
  label?: string
}) {
  return (
    <span
      className="nx-status"
      data-tone={tone}
      role="status"
      aria-label={
        label ?? (typeof children === 'string' ? children : undefined)
      }
    >
      <i aria-hidden="true" />
      {tone === 'ok' ? null : children}
    </span>
  )
}
export function Meter({
  used,
  total,
  label,
}: {
  used: number
  total: number
  label: ReactNode
}) {
  const value = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0
  return (
    <div className="nx-capacity">
      <div className="nx-meter-label">{label}</div>
      <meter
        className="sr-only"
        aria-label={typeof label === 'string' ? label : undefined}
        value={value}
        min={0}
        max={100}
      />
      <div className="nx-meter" data-warning={value > 90} aria-hidden="true">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}
export function Banner({
  tone = 'error',
  children,
  action,
  className,
  ...props
}: ComponentProps<'div'> & { tone?: 'error' | 'warn'; action?: ReactNode }) {
  return (
    <div
      {...props}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('nx-banner', className)}
      data-tone={tone}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}
export function Chip({
  children,
  tone,
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'error' | 'live' }) {
  return (
    <span {...props} className={cn('nx-chip', className)} data-tone={tone}>
      {children}
    </span>
  )
}
export function Choice({
  className,
  ...props
}: ComponentProps<typeof SettingChoice>) {
  return <SettingChoice {...props} className={cn('nx-choice', className)} />
}
export function Segmented({
  label,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string
  value: string
  choices: { value: string; label: string; disabled?: boolean }[]
  onChange(value: string): void
  disabled?: boolean
}) {
  return (
    <fieldset className="nx-segmented" aria-label={label}>
      {choices.map((item) => (
        <Button
          key={item.value}
          variant="quiet"
          aria-pressed={item.value === value}
          disabled={disabled || item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </fieldset>
  )
}
export function Switch({
  className,
  ...props
}: ComponentProps<typeof BaseSwitch>) {
  return (
    <BaseSwitch customThumb {...props} className={cn('nx-switch', className)} />
  )
}
export function Input({
  className,
  ...props
}: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      spellCheck={false}
      {...props}
      className={cn('nx-input', className)}
    />
  )
}
export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/components/ui/dialog'

import { DialogContent as BaseDialogContent } from '@renderer/components/ui/dialog'
export function DialogContent({
  className,
  ...props
}: ComponentProps<typeof BaseDialogContent>) {
  return <BaseDialogContent {...props} className={cn('nx-dialog', className)} />
}
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'

import { DropdownMenuContent as BaseMenuContent } from '@renderer/components/ui/dropdown-menu'
export function DropdownMenuContent({
  className,
  ...props
}: ComponentProps<typeof BaseMenuContent>) {
  return <BaseMenuContent {...props} className={cn('nx-menu', className)} />
}

export { Textarea } from '@renderer/components/ui/textarea'

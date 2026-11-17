import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'

export function SettingChoice({
  label,
  value,
  choices,
  disabled,
  onChange,
  id,
  className = 'select',
  ref,
  keepFocusWhenDisabled = false,
}: {
  label: string
  value: string
  choices: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean
  onChange(value: string): void
  id?: string
  className?: string
  ref?: React.Ref<HTMLButtonElement>
  keepFocusWhenDisabled?: boolean
}) {
  return (
    <Select
      value={value}
      readOnly={disabled && keepFocusWhenDisabled}
      onValueChange={(next) => {
        if (!disabled && next !== null) onChange(next)
      }}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        className={className}
        aria-label={label}
        disabled={disabled && !keepFocusWhenDisabled}
        aria-disabled={disabled || undefined}
      >
        <SelectValue>
          {choices.find((choice) => choice.value === value)?.label ?? '—'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {choices.map((choice) => (
          <SelectItem
            key={choice.value}
            value={choice.value}
            disabled={choice.disabled}
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

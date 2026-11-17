import type { MotrixIconProps } from './create-icon'
import { createIcon } from './create-icon'

function WindowMaximizeGlyph(props: MotrixIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      {...props}
    >
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  )
}

export const WindowMaximizeIcon = /* @__PURE__ */ createIcon(
  'window-maximize',
  WindowMaximizeGlyph,
  'nexus'
)

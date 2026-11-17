import { forwardRef } from 'react'
import { createIcon, type MotrixIconProps } from './create-icon'

const Glyph = forwardRef<SVGSVGElement, MotrixIconProps>(
  function Glyph(props, ref) {
    return (
      <svg
        aria-hidden="true"
        ref={ref}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    )
  }
)
export const LocalDeviceIcon = /* @__PURE__ */ createIcon(
  'local-device',
  Glyph,
  'nexus'
)

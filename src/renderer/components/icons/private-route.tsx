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
        strokeLinejoin="round"
        {...props}
      >
        <path d="M12 3l8 4v5c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V7z" />
      </svg>
    )
  }
)
export const PrivateRouteIcon = /* @__PURE__ */ createIcon(
  'private-route',
  Glyph,
  'nexus'
)

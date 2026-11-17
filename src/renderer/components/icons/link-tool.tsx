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
        {...props}
      >
        <path d="M4 6h16M4 12h10M4 18h7" />
      </svg>
    )
  }
)
export const LinkToolIcon = /* @__PURE__ */ createIcon(
  'link-tool',
  Glyph,
  'nexus'
)

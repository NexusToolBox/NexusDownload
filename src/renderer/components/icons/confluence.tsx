import { forwardRef } from 'react'
import { createIcon, type MotrixIconProps } from './create-icon'

const Glyph = forwardRef<SVGSVGElement, MotrixIconProps>(
  function Glyph(props, ref) {
    return (
      <svg
        aria-hidden="true"
        ref={ref}
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M7 4 C7 9 12 10 16 13" opacity=".6" />
        <path d="M25 4 C25 9 20 10 16 13" opacity=".6" />
        <path d="M16 4v22m-5-5 5 5 5-5" />
      </svg>
    )
  }
)

export const ConfluenceIcon = /* @__PURE__ */ createIcon(
  'confluence',
  Glyph,
  'nexus'
)

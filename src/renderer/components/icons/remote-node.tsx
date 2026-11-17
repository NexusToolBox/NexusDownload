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
        <rect x="4" y="4" width="16" height="7" rx="2" />
        <rect x="4" y="13" width="16" height="7" rx="2" />
        <path d="M8 7.5h.01M8 16.5h.01" />
      </svg>
    )
  }
)
export const RemoteNodeIcon = /* @__PURE__ */ createIcon(
  'remote-node',
  Glyph,
  'nexus'
)

import type { MotrixIconProps } from './create-icon'
import { createIcon } from './create-icon'

function DownloadPauseGlyph(props: MotrixIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      {...props}
    >
      <path d="M9 6v12M15 6v12" />
    </svg>
  )
}

export const DownloadPauseIcon = /* @__PURE__ */ createIcon(
  'download-pause',
  DownloadPauseGlyph,
  'nexus'
)

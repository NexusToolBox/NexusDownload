import { useTaskSpeedHistory } from '@renderer/hooks/use-task-speed-history'
import { useId } from 'react'
import { speedPath } from './speed-path'

export function NexusTaskSpeedChart({ taskId }: { taskId: string }) {
  const { history } = useTaskSpeedHistory(taskId)
  const gradient = useId()
  const line = speedPath(history)
  return (
    <svg
      viewBox="0 0 276 44"
      preserveAspectRatio="none"
      className="nexus-speed-chart"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--live)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--live)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {line && (
        <>
          <path d={`${line} L276 44 L0 44Z`} fill={`url(#${gradient})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--live)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

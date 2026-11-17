import pan115 from '@renderer/assets/cloud-logos/115.png'
import pan123 from '@renderer/assets/cloud-logos/123.png'
import aliyun from '@renderer/assets/cloud-logos/aliyun.png'
import baidu from '@renderer/assets/cloud-logos/baidu.png'
import quark from '@renderer/assets/cloud-logos/quark.png'
import uc from '@renderer/assets/cloud-logos/uc.png'
import type { CloudAccount, CloudPlatform } from '@shared/schemas/nexus-cloud'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
export const NEXUS_PLATFORMS = [
  { key: 'baidu', color: '#2F6BFF' },
  { key: 'quark', color: '#3C5BFF' },
  { key: 'uc', color: '#F07C1A' },
  { key: 'aliyun', color: '#5C4EE5' },
  { key: '115', color: '#2B8CFF' },
  { key: '123', color: '#1E9E8E' },
] as const
const logos = { baidu, quark, uc, aliyun, '115': pan115, '123': pan123 }
export function PlatformLogo({
  platform,
  small = false,
}: {
  platform: CloudPlatform
  small?: boolean
}) {
  const { t } = useTranslation()
  return (
    <span className={`nx-platform-logo${small ? ' sm' : ''}`}>
      <img src={logos[platform]} alt={t(`nexus.platform.${platform}`)} />
    </span>
  )
}
export function accountName(account: CloudAccount, fallback: string) {
  const name = account.profile?.nickname || fallback
  return /^1\d{10}$/.test(name)
    ? `${name.slice(0, 3)}****${name.slice(7)}`
    : name
}
export function AccountAvatar({ account }: { account: CloudAccount }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState('')
  const name = accountName(account, t(`nexus.platform.${account.platform}`))
  return (
    <span className="nx-profile-avatar">
      {account.avatarData && failed !== account.avatarData ? (
        <img
          src={account.avatarData}
          alt=""
          onError={() => setFailed(account.avatarData ?? '')}
        />
      ) : (
        <span
          style={{
            background: NEXUS_PLATFORMS.find((p) => p.key === account.platform)
              ?.color,
          }}
        >
          {[...name][0]}
        </span>
      )}
      <PlatformLogo platform={account.platform} small />
    </span>
  )
}

import { toast } from '@renderer/components/ui/toast'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useCloud } from './cloud-client'

export function AccountHealthNotice() {
  const state = useCloud()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const expired =
    state?.accounts
      .filter((a) => a.reason === 'login' || a.health?.login === 'expired')
      .map((a) => a.id)
      .sort()
      .join(',') ?? ''
  useEffect(() => {
    const id = 'nexus-cloud-login-expired'
    if (!expired) {
      toast.close(id)
      return
    }
    toast.add({
      id,
      title: t('nexus.cloudV3.expiredWarning'),
      type: 'warning',
      timeout: 0,
      actionProps: {
        children: t('nexus.nav.cloud'),
        onClick: () => void navigate('/cloud'),
      },
    })
    return () => toast.close(id)
  }, [expired, t, navigate])
  return null
}

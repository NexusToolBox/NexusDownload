import { Button } from '@renderer/components/desktop-kit/nexus'
import { ChevronDownIcon } from '@renderer/components/icons'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function AdvancedGroup({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Collapsible className="nx-advanced">
      <CollapsibleTrigger
        render={<Button variant="quiet" className="nx-advanced-trigger" />}
      >
        {t('nexus.v13.advanced')}
        <ChevronDownIcon />
      </CollapsibleTrigger>
      <CollapsibleContent className="nx-advanced-content">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

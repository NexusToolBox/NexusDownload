import { DirectoryPicker } from '@renderer/components/desktop-kit/directory-picker'
import { Group, Item } from '@renderer/components/desktop-kit/nexus'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import type { AddTaskFormValues } from '@shared/schemas/add-task'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { AdvancedPanel } from './advanced-panel'
import { UrlTextarea } from './url-textarea'

export function LinksTabPanel({
  advancedDefaultOpen = false,
}: {
  advancedDefaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const requestOptions = useWatch<AddTaskFormValues, 'legacyRequestOptions'>({
    name: 'legacyRequestOptions',
  })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {requestOptions !== undefined && (
        <Alert>
          <AlertDescription className="space-y-1 text-xs">
            <p>{t('legacyImport.requestSettingsDescription')}</p>
            {requestOptions.length > 0 && (
              <p className="break-words">
                {t('legacyImport.requestOptions', {
                  options: requestOptions.join(', '),
                })}
              </p>
            )}
            {requestOptions.some(
              (name) =>
                [
                  'load-cookies',
                  'http-user',
                  'http-passwd',
                  'no-netrc',
                ].includes(name) || name.includes('proxy')
            ) && <p>{t('legacyImport.requestSettingsHelp')}</p>}
          </AlertDescription>
        </Alert>
      )}
      <Group>
        <Item>
          <div className="w-full min-w-0">
            <UrlTextarea name="urls" autoFocus />
          </div>
        </Item>
        <Item title={t('task.add.saveTo')}>
          <DirectoryPicker
            name="saveDir"
            variant="compact"
            showHistory
            placeholder={t('task.add.saveDirEmpty')}
          />
        </Item>
      </Group>
      <AdvancedPanel defaultOpen={advancedDefaultOpen} />
    </div>
  )
}

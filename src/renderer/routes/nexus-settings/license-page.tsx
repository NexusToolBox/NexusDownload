import { Button, Group, Item } from '@renderer/components/desktop-kit/nexus'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
} from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { NEXUS_RELEASE_CONFIG } from '@shared/nexus-release-config'
import { Commands } from '@shared/protocol/commands'
import { Queries } from '@shared/protocol/queries'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'

interface License {
  name: string
  license: string
  text: string
}
export function LicensePage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [licenses, setLicenses] = useState<License[]>([])
  const [failed, setFailed] = useState(false)
  const selected = params.get('component')
  const other = params.get('licenses') === 'other'
  const component = licenses.find((row) => row.name === selected)
  const load = () => {
    setFailed(false)
    void transport
      .invoke(Queries.GetNexusLicenses)
      .then((value) => setLicenses(value as License[]))
      .catch(() => setFailed(true))
  }
  useEffect(load, [])
  const go = (licenses: string, component?: string) =>
    setParams({
      section: 'about',
      licenses,
      ...(component ? { component } : {}),
    })
  return (
    <div className="nx-license-page">
      <Button
        variant="quiet"
        onClick={() =>
          selected
            ? go(other ? 'other' : 'main')
            : other
              ? go('main')
              : setParams({ section: 'about' })
        }
      >
        <ArrowLeftIcon />
        {t('applicationMenu.back')}
      </Button>
      <h2>{component?.name ?? t('nexus.v13.update.licenses')}</h2>
      {component ? (
        <pre className="nx-license-text">{component.text}</pre>
      ) : (
        <>
          {!other && <p>{t('nexus.v152.licenseIntro')}</p>}
          {failed && <Button onClick={load}>{t('common.retry')}</Button>}
          <Group>
            {(other ? licenses.slice(4) : licenses.slice(0, 4)).map((row) => (
              <Item key={row.name} title={row.name} description={row.license}>
                <Button
                  variant="quiet"
                  aria-label={row.name}
                  onClick={() => go(other ? 'other' : 'main', row.name)}
                >
                  <ChevronRightIcon />
                </Button>
              </Item>
            ))}
            {!other && (
              <>
                <Item
                  title={t('nexus.v152.otherComponents', {
                    count: Math.max(0, licenses.length - 4),
                  })}
                >
                  <Button
                    variant="quiet"
                    aria-label={t('nexus.v152.otherComponents', {
                      count: Math.max(0, licenses.length - 4),
                    })}
                    onClick={() => go('other')}
                  >
                    <ChevronRightIcon />
                  </Button>
                </Item>
                <Item title={t('nexus.v152.sourceCode')}>
                  <Button
                    variant="quiet"
                    aria-label={t('nexus.v152.sourceCode')}
                    onClick={() =>
                      void transport.invoke(
                        Commands.OpenExternal,
                        `https://github.com/${NEXUS_RELEASE_CONFIG.repository}`
                      )
                    }
                  >
                    <ArrowUpRightIcon />
                  </Button>
                </Item>
              </>
            )}
          </Group>
        </>
      )}
    </div>
  )
}

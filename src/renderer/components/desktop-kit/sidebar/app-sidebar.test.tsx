import '@testing-library/jest-dom/vitest'
import '@renderer/lib/i18n'
import { SidebarProvider } from '@renderer/components/ui/sidebar'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useLegacyImportSidebar } from '@renderer/features/legacy-import/sidebar-preference'
import { transport } from '@renderer/lib/transport'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import { act, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from './app-sidebar'

// The footer's NotificationsNavItem (Task 17R) calls useNotifications(),
// which talks to the transport on mount — stub it so this render-only suite
// doesn't depend on window.motrix / a real IPC bridge.
vi.mock('@renderer/lib/transport', () => ({
  transport: {
    invoke: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

beforeEach(() => {
  useLegacyImportSidebar.setState({ dismissed: false })
  vi.mocked(transport.on).mockClear()
  vi.mocked(transport.invoke)
    .mockReset()
    .mockImplementation(async (channel) => {
      if (channel === Queries.GetLegacyImportNavigation)
        return { detected: false, invitationPending: false }
      return []
    })
})

// jsdom 29 + Node 25 do not provide a working window.localStorage.
// SidebarProvider reads/writes SIDEBAR_STATE_KEY, so stub it here.
// matchMedia is also missing in jsdom and used by the mobile hook.
beforeAll(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  })
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
})

function wrap(ui: ReactElement, initialEntries: string[] = ['/']) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <SidebarProvider>{ui}</SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>
  )
}

describe('AppSidebar', () => {
  it('links all five product pages and marks the current page', async () => {
    render(wrap(<AppSidebar />, ['/cloud']))
    for (const [name, href] of [
      ['Downloads', '/downloads/all'],
      ['Cloud', '/cloud'],
      ['Media', '/media'],
      ['Services', '/services'],
      ['Settings', '/settings'],
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(name, 'i') })
      ).toHaveAttribute('href', href)
    }
    expect(screen.getByRole('link', { name: /Cloud/i })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await act(async () => Promise.resolve())
    expect(transport.invoke).not.toHaveBeenCalledWith(
      Queries.DiscoverLegacyImport
    )
  })
  it('opens queue settings from the queue list', () => {
    const { container } = render(wrap(<AppSidebar />))
    expect(container.querySelector('.queue')).toHaveAttribute(
      'href',
      '/settings?section=queues'
    )
  })
})

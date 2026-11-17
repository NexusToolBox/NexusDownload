import '@test-utils/dom-animations'
import '@testing-library/jest-dom/vitest'
import '@renderer/lib/i18n'
import { useDownloadsSelection } from '@renderer/routes/downloads/store'
import { useDownloadsView } from '@renderer/routes/downloads/view-preferences'
import { SettingsPage } from '@renderer/routes/settings/settings-page'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import { makeDownloadTask } from '@test-utils/task'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './app-layout'

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  })
}

function renderAppLayout(
  routeHandle?: Record<string, unknown>,
  initialEntry = '/'
) {
  // AppLayout uses useMatches() which only works under a data router.
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <div>INDEX_PAGE</div>, handle: routeHandle },
          { path: 'downloads/:filter', element: <div>DOWNLOADS_PAGE</div> },
          { path: 'plugins/:id', element: <div>PLUGIN_PAGE</div> },
          { path: 'migration', element: null },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [{ path: ':cardId', element: null }],
          },
        ],
      },
    ],
    { initialEntries: [initialEntry] }
  )
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  useDownloadsSelection.getState().clearSelection()
  useDownloadsView.setState({ inspectorVisible: false })
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      motrix: {
        platform: 'darwin',
        invoke: vi
          .fn()
          .mockImplementation(async (channel) =>
            channel === Queries.GetNexusWorkflow
              ? { queues: [], countdowns: {}, diskBlocked: [] }
              : {}
          ),
        on: vi.fn().mockReturnValue(() => {}),
        off: vi.fn(),
      },
    })
  )

  // jsdom 29 gap — SidebarProvider reads localStorage on mount
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    writable: true,
  })

  // useIsMobile reads innerWidth — reset to desktop width so the
  // mobile-mode test's override doesn't leak into other tests
  setWindowWidth(1024)

  // jsdom 29 gap — useIsMobile reads matchMedia
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    writable: true,
  })

  // Radix components (inside shadcn Sidebar) use ResizeObserver
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

describe('AppLayout', () => {
  it.each([
    ['/downloads/all', false],
    ['/downloads/active', false],
    ['/downloads/completed', false],
    ['/downloads/error', false],
    ['/plugins/example', true],
  ] as const)(
    'clears stale task details only for the downloads fallback: %s',
    async (path, keepsSelection) => {
      const task = makeDownloadTask({ id: 'previous-task' })
      useDownloadsSelection.getState().setItems([task])
      useDownloadsSelection.getState().select(task.id)
      useDownloadsView.setState({ inspectorVisible: true })
      const router = renderAppLayout()
      const handler = vi
        .mocked(window.motrix.on)
        .mock.calls.find(([channel]) => channel === Events.NavigateTo)?.[1]
      expect(handler).toBeTypeOf('function')
      await act(async () => handler?.(path))
      expect(router.state.location.pathname).toBe(path)
      expect([
        ...useDownloadsSelection.getState().committedSelectedIds,
      ]).toEqual(keepsSelection ? [task.id] : [])
      expect(useDownloadsView.getState().inspectorVisible).toBe(keepsSelection)
    }
  )

  it('renders window controls with a draggable title bar', async () => {
    renderAppLayout()
    expect(screen.getByRole('button', { name: /Minimize/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /Maximize/i })).toBeVisible()
    expect(document.querySelector('.titlebar')).toHaveClass('app-drag')
  })

  it('keeps Electron chrome safe-area overrides out of the web target', () => {
    vi.stubGlobal('__MOTRIX_TARGET__', 'web')

    renderAppLayout()

    expect(
      document.querySelector('[data-slot="sidebar-wrapper"]')
    ).not.toHaveClass('electron-window-chrome')
    vi.stubGlobal('__MOTRIX_TARGET__', 'electron')
  })

  it('closes the window through the title bar action', () => {
    renderAppLayout()
    fireEvent.click(screen.getByRole('button', { name: /Close window/i }))
    expect(window.motrix.invoke).toHaveBeenCalledWith(
      Commands.CloseCurrentWindow
    )
  })

  it('reports data-state=collapsed in mobile mode regardless of open flag', () => {
    // Below the md breakpoint the docked sidebar cannot be visible, so the
    // wrapper must report collapsed even when the desktop `open` flag is
    // still true. Compact-header styles key off
    // group-data-[state=collapsed]/sidebar-wrapper and must fire on both
    // paths: "collapse then shrink" and "shrink while expanded".
    setWindowWidth(500)
    renderAppLayout()
    const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]')
    expect(wrapper).toHaveAttribute('data-state', 'collapsed')
  })

  it('renders the sidebar and the current route outlet', () => {
    renderAppLayout()
    // Sidebar nav items
    expect(screen.getByText('Downloads')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    // Outlet rendered
    expect(screen.getByText('INDEX_PAGE')).toBeInTheDocument()
  })

  it('mounts the initial non-settings outlet only once and does not scan while migration is hidden', async () => {
    renderAppLayout()
    expect(screen.getAllByText('INDEX_PAGE')).toHaveLength(1)
    await act(async () => Promise.resolve())
    expect(window.motrix.invoke).not.toHaveBeenCalledWith(
      Queries.DiscoverLegacyImport
    )
  })

  it('retains the settings outlet while visiting Downloads', async () => {
    const router = renderAppLayout(undefined, '/settings')
    await waitFor(() => expect(screen.getByText('General')).toBeVisible())
    const content =
      document.querySelector('[data-slot="settings-page"]') ??
      screen.getByText('General')
    await act(async () => {
      await router.navigate('/downloads/all')
    })
    expect(screen.getByText('DOWNLOADS_PAGE')).toBeVisible()
    expect(content).toBeInTheDocument()
    await act(async () => {
      await router.navigate('/settings')
    })
    expect(screen.getByText('General')).toBeVisible()
  })
})

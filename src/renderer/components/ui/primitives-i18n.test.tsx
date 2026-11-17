import '@testing-library/jest-dom/vitest'
import { i18n } from '@renderer/lib/i18n'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog'
import { Sheet, SheetContent, SheetTitle } from './sheet'
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from './sidebar'

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  })
  vi.stubGlobal('innerWidth', 1024)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en-US')
})

describe('shared control localization', () => {
  it('updates both dialog close controls without reopening the dialog', async () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Example</DialogTitle>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    )
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2)
    await act(() => i18n.changeLanguage('fr'))
    const buttons = screen.getAllByRole('button', { name: 'Fermer' })
    expect(buttons).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.click(buttons[0])
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })

  it('updates the sheet close control while it is open', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet defaultOpen onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>Example</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    await act(() => i18n.changeLanguage('zh-TW'))
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })

  it('localizes the sidebar trigger and rail without losing toggle behavior', async () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    )
    await act(() => i18n.changeLanguage('fr'))
    const label = 'Afficher ou masquer la barre latérale'
    const controls = screen.getAllByRole('button', { name: label })
    expect(controls).toHaveLength(2)
    expect(screen.queryByText('Toggle Sidebar')).toBeNull()
    expect(screen.getByTitle(label)).toBeInTheDocument()
    fireEvent.click(controls[0])
    expect(
      container.querySelector('[data-slot="sidebar-wrapper"]')
    ).toHaveAttribute('data-state', 'collapsed')
    fireEvent.click(controls[1])
    expect(
      container.querySelector('[data-slot="sidebar-wrapper"]')
    ).toHaveAttribute('data-state', 'expanded')
  })

  it('gives the narrow-screen navigation sheet a localized name and description', async () => {
    vi.stubGlobal('innerWidth', 600)
    await i18n.changeLanguage('fr')
    render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>Navigation</Sidebar>
      </SidebarProvider>
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Afficher ou masquer la barre latérale',
      })
    )
    expect(
      await screen.findByRole('dialog', { name: 'Barre latérale' })
    ).toHaveAccessibleDescription('Navigation dans l’application.')
  })
})

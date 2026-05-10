import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InstallPrompt from '../InstallPrompt'

const DISMISS_KEY = 'rr_pwa_install_dismissed_v1'

function setupMatchMedia(standaloneMatches = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: standaloneMatches && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function makeInstallEvent() {
  return Object.assign(new Event('beforeinstallprompt'), {
    preventDefault: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  })
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
    setupMatchMedia(false)
    Object.defineProperty(navigator, 'standalone', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('(a) renders banner when beforeinstallprompt fires', async () => {
    render(<InstallPrompt />)
    act(() => { window.dispatchEvent(makeInstallEvent()) })
    expect(await screen.findByRole('button', { name: /install app/i })).toBeInTheDocument()
  })

  it('(b) does NOT render when dismissed flag is set in localStorage', () => {
    localStorage.setItem(DISMISS_KEY, 'true')
    render(<InstallPrompt />)
    act(() => { window.dispatchEvent(makeInstallEvent()) })
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument()
  })

  it('(c) does NOT render when display-mode: standalone matches', () => {
    setupMatchMedia(true)
    render(<InstallPrompt />)
    act(() => { window.dispatchEvent(makeInstallEvent()) })
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument()
  })

  it('(d) clicking dismiss sets the flag and removes the banner', async () => {
    const user = userEvent.setup()
    render(<InstallPrompt />)
    act(() => { window.dispatchEvent(makeInstallEvent()) })

    const dismissBtn = await screen.findByRole('button', { name: /dismiss install prompt/i })
    await user.click(dismissBtn)

    expect(localStorage.getItem(DISMISS_KEY)).toBe('true')
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument()
  })
})

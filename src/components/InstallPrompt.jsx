import { useState, useEffect } from 'react'
import { X, Download } from 'lucide-react'

const DISMISS_KEY = 'rr_pwa_install_dismissed_v1'

function isStandalone() {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      Boolean(navigator.standalone)
    )
  } catch {
    return false
  }
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  )

  useEffect(() => {
    if (dismissed || isStandalone()) return

    function handler(e) {
      e.preventDefault()
      setInstallEvent(e)
    }

    try {
      window.addEventListener('beforeinstallprompt', handler)
    } catch {
      // PWA not supported in this environment — ignore
    }

    return () => {
      try {
        window.removeEventListener('beforeinstallprompt', handler)
      } catch {
        // ignore
      }
    }
  }, [dismissed])

  if (!installEvent || dismissed || isStandalone()) return null

  async function handleInstall() {
    try {
      await installEvent.prompt()
      await installEvent.userChoice
    } catch {
      // prompt() may throw if called more than once or if the event is stale
    } finally {
      setInstallEvent(null)
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  return (
    <div
      role="complementary"
      aria-label="Install app banner"
      className="fixed bottom-20 left-0 right-0 mx-auto max-w-md px-4 z-40"
    >
      <div className="card flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Download size={18} className="text-brand-500 flex-shrink-0 mt-1" />
          <p className="body-text flex-1">
            Add to your home screen for the best experience.
          </p>
          <button
            className="btn-icon"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
          >
            <X size={16} />
          </button>
        </div>
        <button className="btn-primary" onClick={handleInstall}>
          Install App
        </button>
      </div>
    </div>
  )
}

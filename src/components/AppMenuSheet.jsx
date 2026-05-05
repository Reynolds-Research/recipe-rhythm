import { Sheet } from 'react-modal-sheet'
import { Settings, LogOut } from 'lucide-react'
import { useHaptics } from '../hooks/useHaptics'

/**
 * AppMenuSheet — bottom-sheet menu opened from the top-right corner of the
 * app shell. Holds low-frequency app-level actions (Settings, Sign out) so
 * they don't take a bottom-nav slot. Mounted in App.jsx alongside the menu
 * trigger.
 */
export default function AppMenuSheet({ isOpen, onOpenSettings, onSignOut, onClose }) {
  const { trigger } = useHaptics()

  const handleSettings = () => {
    trigger('light')
    onOpenSettings?.()
    onClose?.()
  }

  const handleSignOut = () => {
    trigger('light')
    onSignOut?.()
    onClose?.()
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} detent="content-height">
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-5 pt-2 pb-safe" role="menu" aria-label="App menu">
            <button
              role="menuitem"
              onClick={handleSettings}
              className="w-full min-h-[44px] flex items-center gap-3 py-3 text-left rounded-xl hover:bg-cream-100/60 transition-colors"
            >
              <Settings size={18} className="text-brand-600" />
              <span className="body-text">Settings</span>
            </button>
            <button
              role="menuitem"
              onClick={handleSignOut}
              className="w-full min-h-[44px] flex items-center gap-3 py-3 text-left rounded-xl hover:bg-cream-100/60 transition-colors"
            >
              <LogOut size={18} className="text-gray-600" />
              <span className="body-text">Sign out</span>
            </button>
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}

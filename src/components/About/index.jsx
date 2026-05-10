import { ChevronLeft, Heart } from 'lucide-react'
import Logo from '../Logo'
import { SUBTITLE, LETTER_HEADING, LETTER_BODY } from './copy'

export default function About({ onBack }) {
  return (
    <div className="min-h-screen bg-cream-50 pb-32">
      <button
        onClick={onBack}
        className="btn-icon absolute top-[max(20px,env(safe-area-inset-top))] left-[max(20px,env(safe-area-inset-left))] z-10"
        aria-label="Back to Settings"
      >
        <ChevronLeft size={18} />
      </button>

      <header className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center pt-[max(20px,env(safe-area-inset-top))]">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">Recipe Rhythm</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">{SUBTITLE}</p>
      </header>

      <div className="px-5 pt-5 space-y-6">
        <section>
          <h2 className="section-heading mb-4">{LETTER_HEADING}</h2>
          <div className="space-y-4">
            {LETTER_BODY.map((paragraph, i) => (
              <p key={i} className="body-text">{paragraph}</p>
            ))}
          </div>
        </section>

        <footer className="flex items-center justify-center gap-1.5 py-4">
          <Heart size={12} className="text-brand-500" fill="currentColor" />
        </footer>
      </div>
    </div>
  )
}

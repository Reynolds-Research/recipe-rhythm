import { useState, useEffect } from 'react'
import { BookOpen, Pencil, Loader2, Menu, CalendarDays } from 'lucide-react'
import ChefKnife from './components/ChefKnife'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import LogMode from './pages/LogMode'
import BrainstormMode from './pages/BrainstormMode'
import Vault from './pages/Vault'
import GroceryList from './pages/GroceryList'
import CalendarView from './components/CalendarView'
import Preferences from './components/Preferences'
import AppMenuSheet from './components/AppMenuSheet'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const [session, setSession]         = useState(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [page, setPage]               = useState('log')
  const [recentMeals, setRecentMeals] = useState([])
  const [menuOpen, setMenuOpen]       = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoadingSession(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchRecentMeals = async () => {
    if (!session?.user?.id) return
    const { data, error } = await supabase
      .from('meals')
      .select('id, name, eaten_on')
      .eq('user_id', session.user.id)
      .order('eaten_on', { ascending: false })
      .limit(10)
    if (!error && data) setRecentMeals(data)
  }

  useEffect(() => { 
    if (session) fetchRecentMeals() 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  if (loadingSession) {
    return <div className="min-h-screen bg-cream-50 flex items-center justify-center"><Loader2 className="animate-spin text-brand-500" size={32} /></div>
  }

  if (!session) {
    return <Auth />
  }

  const userId = session.user.id

  return (
    <div className="max-w-md mx-auto relative">
      <button
        onClick={() => setMenuOpen(true)}
        className="btn-icon absolute top-[max(20px,env(safe-area-inset-top))] right-[max(20px,env(safe-area-inset-right))] z-50"
        title="Menu"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      <ErrorBoundary>
      <main>
        {page === 'log' && (
          <LogMode recentMeals={recentMeals} onSave={fetchRecentMeals} userId={userId} />
        )}
        {page === 'brainstorm' && (
          <BrainstormMode userId={userId} />
        )}
        {page === 'calendar' && (
          <CalendarView userId={userId} />
        )}
        {page === 'vault' && (
          <Vault userId={userId} />
        )}
        {page === 'grocery' && (
          <GroceryList userId={userId} />
        )}
        {/* TODO (post-PRD-003): convert page-state routing to <NavLink> + <Route>. PRD-003 P0.11 introduced react-router for the public share route only. */}
        {page === 'settings' && (
          <Preferences userId={userId} />
        )}
      </main>
      </ErrorBoundary>
      {/* TODO (post-PRD-003): convert nav entries to <NavLink>. PRD-003 P0.11 introduced react-router for the public share route only. */}
      <nav className="max-w-md mx-auto fixed bottom-0 left-0 right-0 bg-cream-50/80 backdrop-blur-md border-t border-cream-100 flex pb-safe z-50">
        {[
          { id: 'log',        label: 'Log',        Icon: Pencil  },
          { id: 'brainstorm', label: 'Prep Table',  Icon: ChefKnife  },
          { id: 'calendar',   label: 'Calendar',    Icon: CalendarDays  },
          { id: 'vault',      label: 'Cookbook',    Icon: BookOpen  },
        // eslint-disable-next-line no-unused-vars
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium tracking-wide uppercase transition-all
              ${page === id ? 'text-brand-500 scale-110' : 'text-gray-500 hover:text-gray-600'}`}
          >
            <Icon size={20} strokeWidth={page === id ? 2.5 : 2} />
            {label}
          </button>
        ))}
      </nav>
      <AppMenuSheet
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => setPage('settings')}
        onSignOut={() => supabase.auth.signOut()}
      />
    </div>
  )
}

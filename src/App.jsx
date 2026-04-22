import { useState, useEffect } from 'react'
import { BookOpen, Pencil, Loader2, LogOut, CalendarDays } from 'lucide-react'
import ChefKnife from './components/ChefKnife'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import LogMode from './pages/LogMode'
import BrainstormMode from './pages/BrainstormMode'
import Vault from './pages/Vault'
import CalendarView from './components/CalendarView'

export default function App() {
  const [session, setSession]         = useState(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [page, setPage]               = useState('log')
  const [recentMeals, setRecentMeals] = useState([])

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
        onClick={() => supabase.auth.signOut()}
        className="absolute top-[max(20px,env(safe-area-inset-top))] right-[max(20px,env(safe-area-inset-right))] z-50 text-gray-400 hover:text-red-400 transition-colors bg-white/50 backdrop-blur-sm p-3 rounded-full border border-cream-100 shadow-sm"
        title="Sign Out"
        aria-label="Sign out"
      >
        <LogOut size={16} />
      </button>

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
      </main>
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
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium tracking-wide uppercase transition-all
              ${page === id ? 'text-brand-500 scale-110' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Icon size={20} strokeWidth={page === id ? 2.5 : 2} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

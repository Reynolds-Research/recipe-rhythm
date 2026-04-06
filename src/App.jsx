import { useState, useEffect } from 'react'
import { BookOpen, Calendar, Sparkles } from 'lucide-react'
import { supabase } from './lib/supabase'
import LogMode from './pages/LogMode'

export default function App() {
  const [page, setPage]               = useState('log')
  const [recentMeals, setRecentMeals] = useState([])

  const fetchRecentMeals = async () => {
    const { data, error } = await supabase
      .from('meals')
      .select('id, name, eaten_on')
      .order('eaten_on', { ascending: false })
      .limit(10)
    if (!error && data) setRecentMeals(data)
  }

  useEffect(() => { fetchRecentMeals() }, [])

  return (
    <div className="max-w-sm mx-auto relative">
      {page === 'log' && (
        <LogMode recentMeals={recentMeals} onSave={fetchRecentMeals} />
      )}
      {page === 'brainstorm' && (
        <div className="mobile-screen items-center justify-center text-gray-400 text-sm">
          Brainstorm mode — coming soon
        </div>
      )}
      {page === 'vault' && (
        <div className="mobile-screen items-center justify-center text-gray-400 text-sm">
          Vault — coming soon
        </div>
      )}
      <nav className="max-w-sm mx-auto fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex">
        {[
          { id: 'log',        label: 'Log',        Icon: Calendar  },
          { id: 'brainstorm', label: 'Brainstorm',  Icon: Sparkles  },
          { id: 'vault',      label: 'Vault',       Icon: BookOpen  },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors
              ${page === id ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

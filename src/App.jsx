import { useState, useEffect } from 'react'
import { BookOpen, Pencil } from 'lucide-react'
import ChefKnife from './components/ChefKnife'
import { supabase } from './lib/supabase'
import LogMode from './pages/LogMode'
import BrainstormMode from './pages/BrainstormMode'
import Vault from './pages/Vault'

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
        <BrainstormMode />
      )}
      {page === 'vault' && (
        <Vault />
      )}
      <nav className="max-w-sm mx-auto fixed bottom-0 left-0 right-0 bg-cream-50/80 backdrop-blur-md border-t border-cream-100 flex pb-safe">
        {[
          { id: 'log',        label: 'Log',        Icon: Pencil  },
          { id: 'brainstorm', label: 'Prep Table',  Icon: ChefKnife  },
          { id: 'vault',      label: 'Cookbook',    Icon: BookOpen  },
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

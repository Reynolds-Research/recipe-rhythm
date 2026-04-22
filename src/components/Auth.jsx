import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import { Mail, Lock, Loader2, ArrowRight } from 'lucide-react'

export default function Auth() {
  const [loading, setLoading] = useState(false)
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setErrorMsg(error.message)
      else {
        setSuccessMsg('Success! You may now sign in.')
        setIsSignUp(false)
        setPassword('')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setErrorMsg(error.message)
    }
    
    setLoading(false)
  }

  return (
    <div className="mobile-screen items-center justify-center p-5 bg-gradient-to-b from-cream-50 to-white">
      <div className="w-full max-w-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        <div className="text-center space-y-2">
          <Logo className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-xl text-brand-600 font-bold tracking-[0.2em] uppercase">For My Wife</h1>
          <p className="text-sm text-gray-400 font-serif italic">Login to sync your meal plan safely</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                required
                autoComplete="email"
                className="input-base pl-11"
              />
            </div>
            
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="input-base pl-11 pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-brand-500 transition-colors"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-500 font-medium text-center bg-red-50 rounded-xl py-2 px-3 border border-red-100">
              {errorMsg}
            </p>
          )}
          
          {successMsg && (
            <p className="text-xs text-green-600 font-medium text-center bg-green-50 rounded-xl py-2 px-3 border border-green-100">
              {successMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn-primary flex items-center justify-center gap-2 group w-full"
          >
            {loading ? (
              <><Loader2 size={18} className="animate-spin" /> Authenticating…</>
            ) : (
              <>
                {isSignUp ? 'Create account' : 'Sign In'}
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-cream-100">
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(''); }}
            className="text-xs font-bold text-gray-400 hover:text-brand-500 transition-colors uppercase tracking-widest mt-4"
          >
            {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
          </button>
        </div>
      </div>
    </div>
  )
}

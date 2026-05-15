'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.refresh()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="w-full max-w-[320px] px-4">

        <div className="mb-10">
          <div className="text-[11px] tracking-[0.15em] uppercase text-ink-3 mb-1">Oaki Studio</div>
          <h1 className="text-[15px] font-medium text-ink">Sign in</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="Email"
              className="w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Password"
              className="w-full px-3 py-2 bg-surface border border-line rounded-md text-[13px] text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && (
            <p className="text-[12px] text-blocked-text">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-accent text-canvas text-[13px] font-medium rounded-md hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

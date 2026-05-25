'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Brand } from '@/components/ui/Brand'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-6">
      <div className="w-full max-w-[320px]">
        <div className="mb-8 opacity-80">
          <Brand size={18} />
        </div>
        <h1 className="text-display font-semibold text-ink mb-8">Sign in</h1>

        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="Email"
          />
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            placeholder="Password"
          />

          {error && <p className="text-sm text-blocked-text">{error}</p>}

          <Button variant="primary" type="submit" full loading={loading} className="mt-1">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-caption text-ink-2 leading-relaxed">
          Internal tool · request access from an admin.
        </p>
      </div>
    </div>
  )
}

import { createBrowserClient } from '@supabase/ssr'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

export function createClient() {
  return createBrowserClient<DB>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

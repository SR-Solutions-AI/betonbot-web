import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Create a Supabase client for Route Handlers / Server Components that reads session from cookies. */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Ignore in Route Handler when not allowed to set cookies
          }
        },
      },
    },
  )
}

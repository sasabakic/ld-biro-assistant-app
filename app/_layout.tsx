import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; session: Session }
  | { status: 'unauthenticated' }

export default function RootLayout() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState(
        data.session
          ? { status: 'authenticated', session: data.session }
          : { status: 'unauthenticated' },
      )
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(
        session
          ? { status: 'authenticated', session }
          : { status: 'unauthenticated' },
      )
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (state.status === 'loading') return
    const onLogin = segments[0] === 'login'
    if (state.status === 'unauthenticated' && !onLogin) {
      router.replace('/login')
    } else if (state.status === 'authenticated' && onLogin) {
      router.replace('/')
    }
  }, [state, segments, router])

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <Stack screenOptions={{ headerShown: false }} />
}

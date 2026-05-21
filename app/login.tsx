import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { supabase } from '../lib/supabase'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setSubmitting(false)
    if (error) {
      // Generic error — don't leak whether the email exists.
      setError('Pogrešni podaci za prijavu.')
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>LD Biro Asistent</Text>
        <Text style={styles.subtitle}>Prijava</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          style={styles.input}
        />

        <Text style={styles.label}>Lozinka</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          style={styles.input}
          onSubmitEditing={submit}
        />

        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Pressable
          onPress={submit}
          disabled={submitting || !email || !password}
          style={({ pressed }) => [
            styles.button,
            (submitting || !email || !password) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Prijavi se</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 16,
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 16 },
  label: { fontSize: 13, color: '#444', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  error: { color: '#c00', fontSize: 14, marginTop: 8 },
  button: {
    marginTop: 20,
    backgroundColor: '#111',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})

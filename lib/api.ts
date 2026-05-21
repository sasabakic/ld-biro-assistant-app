import type { Client, VoiceApiResponse } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE

if (!API_BASE) {
  throw new Error('Missing EXPO_PUBLIC_API_BASE in .env')
}

/**
 * Upload an audio file to /api/voice and get back the transcript + parsed
 * ticket. The Worker handles Groq Whisper + Gemini parsing.
 *
 * On RN, FormData files use the { uri, name, type } shape rather than a real
 * File object. The audio recorder gives us a local file:// URI.
 */
export async function callVoiceApi(
  audioUri: string,
  clients: Client[],
): Promise<VoiceApiResponse> {
  const form = new FormData()
  form.append('audio', {
    uri: audioUri,
    name: 'voice.m4a',
    type: 'audio/m4a',
  } as unknown as Blob)
  form.append('clients_json', JSON.stringify(clients))

  const res = await fetch(`${API_BASE}/api/voice`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    let message = `Greška ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // not JSON, keep generic message
    }
    throw new Error(message)
  }

  return (await res.json()) as VoiceApiResponse
}

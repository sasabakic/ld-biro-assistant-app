import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio'
import { supabase } from '../lib/supabase'
import { callVoiceApi } from '../lib/api'
import type { Client, ParsedTicket, TicketType } from '../lib/types'

type Bootstrap = {
  userId: string
  firmId: string
  inboxColumnId: string
  clients: Client[]
}

type ScreenState =
  | { kind: 'booting' }
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'processing' }
  | { kind: 'confirming'; transcript: string; parsed: ParsedTicket }
  | { kind: 'saving'; transcript: string; parsed: ParsedTicket }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

const TYPE_LABELS: Record<TicketType, string> = {
  javicu_se: 'Javiću se',
  zaduzenje: 'Zaduženje',
  pitanje: 'Pitanje',
}

export default function MainScreen() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [state, setState] = useState<ScreenState>({ kind: 'booting' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerDraft, setPickerDraft] = useState<Date | null>(null)
  const [clientSearch, setClientSearch] = useState('')
  const [clientPickerOpen, setClientPickerOpen] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        if (!userData.user) throw new Error('Niste prijavljeni.')

        const [firmRes, columnsRes, clientsRes] = await Promise.all([
          supabase.from('firms').select('id').limit(1).maybeSingle(),
          supabase
            .from('columns')
            .select('id, name, position')
            .order('position'),
          supabase.from('clients').select('id, name').order('name'),
        ])

        if (firmRes.error) throw firmRes.error
        if (columnsRes.error) throw columnsRes.error
        if (clientsRes.error) throw clientsRes.error
        if (!firmRes.data) throw new Error('Firma nije postavljena u bazi.')
        if (!columnsRes.data?.length) throw new Error('Nema kolona za firmu.')

        if (cancelled) return
        setBoot({
          userId: userData.user.id,
          firmId: firmRes.data.id,
          inboxColumnId: columnsRes.data[0].id,
          clients: clientsRes.data ?? [],
        })
        setState({ kind: 'idle' })
      } catch (err) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Greška pri učitavanju',
        })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        Alert.alert(
          'Mikrofon',
          'Pristup mikrofonu je odbijen. Otvori podešavanja i dozvoli pristup.',
        )
        return
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setState({ kind: 'recording' })
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'Greška pri pokretanju snimanja',
      })
    }
  }

  async function stopAndProcess() {
    if (!boot) return
    try {
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) throw new Error('Snimak nije sačuvan.')
      setState({ kind: 'processing' })
      setClientSearch('')
      const resp = await callVoiceApi(uri, boot.clients)
      setState({
        kind: 'confirming',
        transcript: resp.transcript,
        parsed: resp.parsed,
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Greška pri obradi',
      })
    }
  }

  async function save() {
    if (state.kind !== 'confirming' || !boot) return
    const { parsed, transcript } = state
    if (!parsed.matched_client_id) {
      Alert.alert(
        'Klijent nije prepoznat',
        'Snimi ponovo sa jasnijim imenom, ili dovrši unos u web aplikaciji.',
      )
      return
    }
    if (!parsed.title.trim()) {
      Alert.alert('Naslov', 'Naslov ne sme biti prazan.')
      return
    }
    setState({ kind: 'saving', transcript, parsed })
    const { error } = await supabase.from('tickets').insert({
      firm_id: boot.firmId,
      client_id: parsed.matched_client_id,
      column_id: boot.inboxColumnId,
      created_by_user_id: boot.userId,
      created_via: 'voice',
      type: parsed.type,
      title: parsed.title.trim(),
      description: parsed.notes?.trim() || null,
      rok: parsed.rok_iso,
      voice_transcript: transcript,
    })
    if (error) {
      setState({
        kind: 'error',
        message: error.message || 'Greška pri čuvanju',
      })
      return
    }
    setState({ kind: 'saved' })
    setTimeout(() => setState({ kind: 'idle' }), 1500)
  }

  function patchParsed(patch: Partial<ParsedTicket>) {
    setState((prev) =>
      prev.kind === 'confirming'
        ? { ...prev, parsed: { ...prev.parsed, ...patch } }
        : prev,
    )
  }

  function currentRokDate(): Date {
    if (state.kind !== 'confirming') return new Date()
    if (state.parsed.rok_iso) return new Date(state.parsed.rok_iso)
    const d = new Date()
    // No existing rok — default the picker open to 09:00 of the current day.
    d.setHours(9, 0, 0, 0)
    return d
  }

  function applyPickedDate(picked: Date) {
    if (state.kind !== 'confirming') return
    // Preserve the time portion from the existing rok (Gemini-parsed). If
    // there was no rok, default to 09:00 — accountants typically set
    // morning-of deadlines.
    const merged = new Date(picked)
    const existing = state.parsed.rok_iso
      ? new Date(state.parsed.rok_iso)
      : null
    if (existing) {
      merged.setHours(existing.getHours(), existing.getMinutes(), 0, 0)
    } else {
      merged.setHours(9, 0, 0, 0)
    }
    patchParsed({ rok_iso: merged.toISOString() })
  }

  function openRokPicker() {
    setPickerDraft(currentRokDate())
    setPickerOpen(true)
  }

  function clearRok() {
    patchParsed({ rok_iso: null })
  }

  // Android: dialog auto-dismisses; on type === 'set' we apply, on 'dismissed' nothing happens.
  // iOS: we keep the modal open and stage the value in pickerDraft until "Potvrdi".
  function onPickerChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') {
      setPickerOpen(false)
      if (event.type === 'set' && date) applyPickedDate(date)
    } else if (date) {
      setPickerDraft(date)
    }
  }

  function confirmIosPick() {
    if (pickerDraft) applyPickedDate(pickerDraft)
    setPickerOpen(false)
  }

  function renderBody() {
    if (state.kind === 'booting') {
      return (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )
    }

    if (state.kind === 'error') {
      return (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Greška</Text>
          <Text style={styles.errorMsg}>{state.message}</Text>
          <Pressable
            onPress={() => setState({ kind: 'idle' })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Pokušaj ponovo</Text>
          </Pressable>
        </View>
      )
    }

    if (state.kind === 'saved') {
      return (
        <View style={styles.center}>
          <Text style={styles.savedGlyph}>✓</Text>
          <Text style={styles.savedText}>Sačuvano</Text>
        </View>
      )
    }

    if (
      state.kind === 'idle' ||
      state.kind === 'recording' ||
      state.kind === 'processing'
    ) {
      const recording = state.kind === 'recording'
      const processing = state.kind === 'processing'
      return (
        <View style={styles.center}>
          <Pressable
            onPress={
              processing
                ? undefined
                : recording
                  ? stopAndProcess
                  : startRecording
            }
            disabled={processing}
            style={({ pressed }) => [
              styles.micButton,
              recording && styles.micButtonRecording,
              pressed && !processing && styles.micButtonPressed,
            ]}
          >
            {processing ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Text style={styles.micGlyph}>{recording ? '■' : '●'}</Text>
            )}
          </Pressable>
          <Text style={styles.micHint}>
            {recording
              ? 'Snimam... pritisni za stop'
              : processing
                ? 'Obrađujem...'
                : 'Pritisni za snimanje'}
          </Text>
        </View>
      )
    }

    // confirming or saving
    const { parsed, transcript } = state
    const saving = state.kind === 'saving'
    return (
      <>
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.label}>Transkript</Text>
        <Text style={styles.transcript}>{transcript}</Text>

        <Text style={styles.label}>Klijent</Text>
        <Pressable
          onPress={() => {
            setClientSearch('')
            setClientPickerOpen(true)
          }}
          style={({ pressed }) => [
            styles.clientButton,
            !parsed.matched_client_id && styles.clientButtonWarn,
            pressed && styles.rokButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.clientButtonText,
              !parsed.matched_client_id && styles.clientButtonTextWarn,
            ]}
            numberOfLines={1}
          >
            {parsed.matched_client_id
              ? parsed.client_name
              : `${parsed.client_name} (nije prepoznat — izaberi)`}
          </Text>
          <Text style={styles.clientButtonArrow}>▾</Text>
        </Pressable>

        <Text style={styles.label}>Tip</Text>
        <View style={styles.typeRow}>
          {(Object.keys(TYPE_LABELS) as TicketType[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => patchParsed({ type: t })}
              style={[
                styles.typeChip,
                parsed.type === t && styles.typeChipActive,
              ]}
            >
              <Text
                style={[
                  styles.typeChipText,
                  parsed.type === t && styles.typeChipTextActive,
                ]}
              >
                {TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Naslov</Text>
        <TextInput
          value={parsed.title}
          onChangeText={(v) => patchParsed({ title: v })}
          style={styles.textInput}
          maxLength={80}
        />

        <Text style={styles.label}>Rok</Text>
        <View style={styles.rokRow}>
          <Pressable
            onPress={openRokPicker}
            disabled={saving}
            style={({ pressed }) => [
              styles.rokButton,
              !parsed.rok_iso && styles.rokButtonEmpty,
              pressed && styles.rokButtonPressed,
            ]}
          >
            <Text
              style={[
                styles.rokButtonText,
                !parsed.rok_iso && styles.rokButtonTextEmpty,
              ]}
            >
              {parsed.rok_iso
                ? new Date(parsed.rok_iso).toLocaleString('sr-Latn')
                : 'Bez roka — pritisni da postaviš'}
            </Text>
          </Pressable>
          {parsed.rok_iso && (
            <Pressable
              onPress={clearRok}
              disabled={saving}
              style={styles.rokClear}
              accessibilityLabel="Ukloni rok"
            >
              <Text style={styles.rokClearText}>×</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.label}>Beleška</Text>
        <TextInput
          value={parsed.notes ?? ''}
          onChangeText={(v) => patchParsed({ notes: v || null })}
          style={[styles.textInput, styles.multiline]}
          multiline
        />

        <View style={styles.actions}>
          <Pressable
            onPress={save}
            disabled={saving}
            style={[styles.button, saving && styles.buttonDisabled]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sačuvaj</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => setState({ kind: 'idle' })}
            disabled={saving}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>Odustani</Text>
          </Pressable>
        </View>
      </ScrollView>

      {Platform.OS === 'android' && pickerOpen && (
        <DateTimePicker
          value={pickerDraft ?? currentRokDate()}
          mode="date"
          onChange={onPickerChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={pickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setPickerOpen(false)}
          >
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <DateTimePicker
                value={pickerDraft ?? currentRokDate()}
                mode="date"
                display="inline"
                themeVariant="light"
                onChange={onPickerChange}
                style={styles.iosDatePicker}
              />
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setPickerOpen(false)}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Odustani</Text>
                </Pressable>
                <Pressable onPress={confirmIosPick} style={styles.button}>
                  <Text style={styles.buttonText}>Potvrdi</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <Modal
        visible={clientPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setClientPickerOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setClientPickerOpen(false)}
          >
            <Pressable style={styles.modalSheetTall} onPress={() => {}}>
              <TextInput
                autoFocus
                value={clientSearch}
                onChangeText={setClientSearch}
                placeholder="Pretraži klijente..."
                autoCorrect={false}
                autoCapitalize="none"
                style={[styles.textInput, styles.clientSearchInput]}
              />
              <ScrollView
                style={styles.clientModalList}
                keyboardShouldPersistTaps="handled"
              >
                {(() => {
                  const q = clientSearch.toLocaleLowerCase('sr-Latn')
                  const matches =
                    boot?.clients.filter((c) =>
                      c.name.toLocaleLowerCase('sr-Latn').includes(q),
                    ) ?? []
                  if (matches.length === 0) {
                    return (
                      <Text style={styles.clientListEmpty}>
                        Nema rezultata.
                      </Text>
                    )
                  }
                  return matches.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        patchParsed({
                          matched_client_id: c.id,
                          client_name: c.name,
                        })
                        setClientPickerOpen(false)
                        setClientSearch('')
                      }}
                      style={({ pressed }) => [
                        styles.clientListItem,
                        pressed && styles.clientListItemPressed,
                      ]}
                    >
                      <Text style={styles.clientListItemText}>{c.name}</Text>
                    </Pressable>
                  ))
                })()}
              </ScrollView>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setClientPickerOpen(false)}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Zatvori</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      </>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>LD Biro Asistent</Text>
        <Pressable onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOut}>Odjavi se</Text>
        </Pressable>
      </View>
      {renderBody()}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#fff',
  },
  title: { fontSize: 17, fontWeight: '700' },
  signOut: { fontSize: 14, color: '#666' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  micButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: { backgroundColor: '#c00' },
  micButtonPressed: { opacity: 0.85 },
  micGlyph: { color: '#fff', fontSize: 64 },
  micHint: { fontSize: 15, color: '#666', marginTop: 12 },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#c00' },
  errorMsg: { fontSize: 14, color: '#444', textAlign: 'center' },
  savedGlyph: { fontSize: 72, color: '#0a7' },
  savedText: { fontSize: 18, color: '#0a7', fontWeight: '600' },
  form: { padding: 20, gap: 4 },
  label: { fontSize: 13, color: '#666', marginTop: 12, marginBottom: 4 },
  transcript: {
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
    fontStyle: 'italic',
  },
  readonly: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  readonlyWarn: { borderColor: '#e90', backgroundColor: '#fff8ec' },
  readonlyText: { fontSize: 15, color: '#222' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#eee',
  },
  typeChipActive: { backgroundColor: '#111' },
  typeChipText: { fontSize: 13, color: '#555' },
  typeChipTextActive: { color: '#fff', fontWeight: '600' },
  textInput: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  rokRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  rokButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    justifyContent: 'center',
  },
  rokButtonEmpty: { borderStyle: 'dashed', backgroundColor: '#fafafa' },
  rokButtonPressed: { opacity: 0.7 },
  rokButtonText: { fontSize: 15, color: '#222' },
  rokButtonTextEmpty: { color: '#888', fontStyle: 'italic' },
  rokClear: {
    width: 44,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rokClearText: { fontSize: 22, color: '#888', lineHeight: 24 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  button: {
    flex: 1,
    backgroundColor: '#111',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },
  secondary: { backgroundColor: '#eee' },
  secondaryText: { color: '#222', fontWeight: '600', fontSize: 16 },
  clientButton: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  clientButtonWarn: { borderColor: '#e90', backgroundColor: '#fff8ec' },
  clientButtonText: { fontSize: 15, color: '#222', flex: 1 },
  clientButtonTextWarn: { color: '#a55' },
  clientButtonArrow: { fontSize: 14, color: '#888' },
  modalSheetTall: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 24,
    marginTop: 60,
  },
  clientSearchInput: { marginBottom: 12 },
  clientModalList: {
    flex: 1,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  clientListItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  clientListItemPressed: { backgroundColor: '#f3f3f3' },
  clientListItemText: { fontSize: 15, color: '#222' },
  clientListEmpty: {
    padding: 16,
    fontSize: 14,
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  iosDatePicker: { alignSelf: 'stretch' },
})

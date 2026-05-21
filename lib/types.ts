export type TicketType = 'pitanje' | 'zaduzenje' | 'javicu_se'

export type ParsedTicket = {
  client_name: string
  matched_client_id: string | null
  type: TicketType
  title: string
  rok_iso: string | null
  notes: string | null
}

export type VoiceApiResponse = {
  transcript: string
  parsed: ParsedTicket
}

export type Client = {
  id: string
  name: string
}

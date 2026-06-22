// Meta WhatsApp Cloud API webhook payload shapes (§16). Only the fields we use
// are typed; everything is optional because we never trust inbound structure.

export interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

export interface MetaEntry {
  id?: string;
  changes?: MetaChange[];
}

export interface MetaChange {
  field?: string;
  value?: MetaChangeValue;
}

export interface MetaChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: unknown[]; // delivery/read receipts — ignored (FR-WA-007)
}

export interface MetaContact {
  wa_id?: string;
  profile?: { name?: string };
}

export interface MetaMessage {
  id?: string; // wamid
  from?: string; // sender wa_id (phone, E.164 without '+')
  timestamp?: string;
  type?: string; // "text" | "interactive" | "button" | "image" | "audio" | ...
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { text?: string; payload?: string };
}

/** Normalised inbound message after parsing — the only shape the rest of the channel deals with. */
export interface InboundMessage {
  wamid: string;
  from: string;
  text: string;
  profileName?: string;
}

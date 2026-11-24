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
  /** Media objects. Only the optional typed caption is read. */
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
}

/** Normalised inbound message after parsing — the only shape the rest of the channel deals with. */
export interface InboundMessage {
  wamid: string;
  from: string;
  text: string;
  profileName?: string;
  /**
   * Meta's `timestamp` in epoch seconds, if it supplied a usable one. Meta's
   * webhook reference calls it the time the webhook was triggered. Whether a
   * message redelivered after an outage keeps its original time or carries a
   * new one is unverified. Do not read it as the time the sender wrote it.
   */
  sentAt?: number;
  /**
   * Meta message type ("audio", "image", ...) when the message carries no text
   * the bot can read. `text` is then "" and the pipeline is not run.
   */
  unsupportedType?: string;
  /**
   * Meta message type ("image", "video" or "document") when `text` is the
   * typed caption of an attachment. The pipeline answers the caption, and a
   * short note then says the attachment itself was not read.
   */
  captionMediaType?: string;
  /**
   * Validated source code from a trailing `(src: <code>)` line, which the
   * website's WhatsApp links add (see whatsapp-source.ts). The line itself has
   * already been removed from `text`.
   */
  sourceCode?: string;
}

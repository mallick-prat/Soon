/**
 * narrow internal provider contract for the imessage layer.
 *
 * NOTHING outside src/imessage/ may import photon (spectrum-ts /
 * @spectrum-ts/imessage-local) types — this file is the boundary.
 */

/** a normalized local imessage row. */
export interface LocalMessage {
  /** stable local message reference (chat.db guid). */
  ref: string;
  /** normalized conversation reference (chat guid / chat id). */
  conversationRef: string;
  /** decoded text body ("" when the row had none). */
  text: string;
  /** epoch millis the message was sent/received. */
  sentAtMs: number;
  /** authored on this device by the local user. */
  isFromMe: boolean;
  /** conversation is a group chat. */
  isGroup: boolean;
  /** best-effort remote participant handles known for this message. */
  participantHandles: string[];
}

/** result of an outbound send attempt. */
export interface SendResult {
  ok: boolean;
  /** local message reference once observed in chat.db (best effort). */
  localMessageRef?: string;
  /** epoch millis the send was accepted/failed. */
  sentAtMs: number;
  errorCode?: string;
  errorMessage?: string;
}

/** unsubscribe handle returned by onMessage. */
export type Unsubscribe = () => void;

/** the only imessage surface the rest of the app is allowed to see. */
export interface ImessageProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** subscribe to every observed message (incoming AND from-me). */
  onMessage(cb: (msg: LocalMessage) => void): Unsubscribe;
  sendMessage(conversationRef: string, text: string): Promise<SendResult>;
  /**
   * bounded history pull: at most `limit` messages, none older than
   * `sinceMs`, ordered oldest → newest.
   */
  getRecentMessages(conversationRef: string, limit: number, sinceMs: number): Promise<LocalMessage[]>;
}

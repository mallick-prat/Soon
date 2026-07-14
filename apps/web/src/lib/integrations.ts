/**
 * narrow local interfaces for the packages being built concurrently
 * (@soon/calendar, @soon/approval-engine, @soon/follow-up-engine,
 * @soon/security, @soon/observability, @soon/message-copy).
 *
 * TODO(integration): replace each stub with the real workspace package once
 * it lands. keep the interfaces narrow so swapping is mechanical.
 */

// TODO(integration): @soon/security — real aes-gcm envelope encryption.
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** placeholder cipher: tags values so unencrypted tokens are detectable */
export const tokenCipher: TokenCipher = {
  encrypt: (plaintext) => `plaintext-stub:${plaintext}`,
  decrypt: (ciphertext) =>
    ciphertext.startsWith("plaintext-stub:")
      ? ciphertext.slice("plaintext-stub:".length)
      : ciphertext,
};

// TODO(integration): @soon/calendar — event creation / reschedule / cancel.
export interface CalendarService {
  createEvent(input: {
    sessionId: string;
    startsAtIso: string;
    endsAtIso: string;
    title: string;
    attendeeEmail?: string;
  }): Promise<{ eventId: string }>;
  cancelEvent(eventId: string): Promise<void>;
}

// TODO(integration): @soon/approval-engine — decides whether a draft can
// auto-send under the active bundle.
export interface ApprovalDecider {
  canAutoSend(draftId: string): Promise<boolean>;
}

// TODO(integration): @soon/follow-up-engine — recomputes attempt schedules
// when the user edits cadence or snoozes a session.
export interface FollowUpScheduler {
  reschedule(sessionId: string, nextAtIso: string): Promise<void>;
  changeCadence(sessionId: string, intervalHours: number[]): Promise<void>;
}

// TODO(integration): @soon/message-copy — canonical user-facing strings.
// until then, dashboard copy lives in src/lib/copy.ts.

// TODO(integration): @soon/observability — structured logging + tracing.
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const logger: Logger = {
  info: (message, fields) => console.info(`[web] ${message}`, fields ?? {}),
  warn: (message, fields) => console.warn(`[web] ${message}`, fields ?? {}),
  error: (message, fields) => console.error(`[web] ${message}`, fields ?? {}),
};

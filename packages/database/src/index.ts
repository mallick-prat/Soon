export { getDb, closeDb, isDatabaseConfigured } from "./client.js";

export {
  RESOLVED_SESSION_STATES,
  UNRESOLVED_SESSION_STATES,
  TERMINAL_SESSION_STATES,
  createSessionFromTrigger,
  transitionSessionState,
  findActiveSessionByConversation,
  snoozeSession,
  type CreateSessionFromTriggerInput,
  type TransitionOptions,
} from "./repos/sessions.js";

export {
  createDraft,
  approveDraft,
  rejectDraft,
  markDraftSent,
  expireDrafts,
  listDraftsAwaitingReview,
  type CreateDraftInput,
  type ApproveDraftOptions,
} from "./repos/drafts.js";

export {
  BUNDLE_DEFAULTS,
  createBundle,
  consumeBundleMessage,
  revokeBundle,
  type CreateBundleInput,
  type ConsumeBundleResult,
} from "./repos/bundles.js";

export {
  UPCOMING_CATEGORIES,
  upcomingCategory,
  compareUpcoming,
  listUpcomingConversations,
  type UpcomingCategory,
  type UpcomingSortable,
  type UpcomingConversation,
} from "./repos/upcoming.js";

export {
  enqueueOutboxCommand,
  advanceOutboxStatus,
  nextPendingCommands,
  pendingCommandsAcrossUsers,
  recordInboxReceipt,
  type EnqueueOutboxCommandInput,
  type AdvanceOutboxResult,
} from "./repos/outbox.js";

// generated prisma client: model types, enums, and the Prisma namespace
export * from "./generated/prisma/client.js";

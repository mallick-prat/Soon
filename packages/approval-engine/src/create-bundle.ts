import { BUNDLE_DEFAULTS, type ApprovalBundle, type BundleObjective } from "@soon/shared-types";

export interface CreateBundleParams {
  id: string;
  sessionId: string;
  allowedObjectives: readonly BundleObjective[];
  approvedSlotIds: readonly string[];
  /** iso date, inclusive */
  approvedDateRangeStart: string;
  /** iso date, inclusive */
  approvedDateRangeEnd: string;
  minimumDurationMinutes: number;
  maximumDurationMinutes: number;
  approvedParticipantIds: readonly string[];
  createdAt: Date;
  /** clamped to BUNDLE_DEFAULTS.maximumOutboundMessages */
  maximumOutboundMessages?: number;
  /** clamped to createdAt + BUNDLE_DEFAULTS.maxAgeHours */
  expiresAt?: Date;
}

const MS_PER_HOUR = 3_600_000;

export function createBundle(params: CreateBundleParams): ApprovalBundle {
  const hardMessageCap = BUNDLE_DEFAULTS.maximumOutboundMessages;
  const requestedMessages = params.maximumOutboundMessages ?? hardMessageCap;
  const maximumOutboundMessages = Math.max(1, Math.min(Math.floor(requestedMessages), hardMessageCap));

  const hardExpiryMs = params.createdAt.getTime() + BUNDLE_DEFAULTS.maxAgeHours * MS_PER_HOUR;
  const requestedExpiryMs = params.expiresAt?.getTime() ?? hardExpiryMs;
  const expiresAt = new Date(Math.min(requestedExpiryMs, hardExpiryMs));

  return {
    id: params.id,
    sessionId: params.sessionId,
    allowedObjectives: [...params.allowedObjectives],
    approvedSlotIds: [...params.approvedSlotIds],
    approvedDateRangeStart: params.approvedDateRangeStart,
    approvedDateRangeEnd: params.approvedDateRangeEnd,
    minimumDurationMinutes: params.minimumDurationMinutes,
    maximumDurationMinutes: params.maximumDurationMinutes,
    approvedParticipantIds: [...params.approvedParticipantIds],
    maximumOutboundMessages,
    messagesUsed: 0,
    expiresAt: expiresAt.toISOString(),
    status: "active",
  };
}

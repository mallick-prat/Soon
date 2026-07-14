import type { ApprovalBundle } from "@soon/shared-types";

export function consumeBundleMessage(bundle: ApprovalBundle): ApprovalBundle {
  const messagesUsed = Math.min(bundle.messagesUsed + 1, bundle.maximumOutboundMessages);
  const status =
    bundle.status === "active" && messagesUsed >= bundle.maximumOutboundMessages
      ? "consumed"
      : bundle.status;
  return { ...bundle, messagesUsed, status };
}

export type BundleLifecycleEvent =
  | { type: "event_created" }
  | { type: "session_cancelled" }
  | { type: "user_takeover" }
  | { type: "time_passed"; now: Date };

export function expireBundleIf(bundle: ApprovalBundle, event: BundleLifecycleEvent): ApprovalBundle {
  if (bundle.status !== "active") {
    return bundle;
  }
  switch (event.type) {
    case "event_created":
    case "session_cancelled":
    case "user_takeover":
      return { ...bundle, status: "revoked" };
    case "time_passed":
      return event.now.getTime() >= new Date(bundle.expiresAt).getTime()
        ? { ...bundle, status: "expired" }
        : bundle;
  }
}

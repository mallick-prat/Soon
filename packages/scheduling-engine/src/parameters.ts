import { MEETING_PRESET_DURATIONS, type MeetingFormat, type MeetingType } from "@soon/shared-types";

export type ParameterSource = {
  /** parsed from trigger modifiers like "📅 30m" / "📅 lunch" */
  triggerModifier?: Partial<ResolvedParameters> | undefined;
  /** parsed from explicit conversation language */
  conversation?: Partial<ResolvedParameters> | undefined;
  /** saved per-contact preference */
  contactPreference?: Partial<ResolvedParameters> | undefined;
  /** the meeting-type preset */
  preset?: Partial<ResolvedParameters> | undefined;
  /** the user's global defaults */
  userDefault: ResolvedParameters;
};

export type ResolvedParameters = {
  meetingType: MeetingType;
  durationMinutes: number;
  format: MeetingFormat;
};

/**
 * parameter priority per spec:
 * trigger modifier > conversation > contact preference > preset > user default
 */
export function resolveMeetingParameters(sources: ParameterSource): ResolvedParameters {
  const layers = [
    sources.userDefault,
    sources.preset,
    sources.contactPreference,
    sources.conversation,
    sources.triggerModifier,
  ];
  const merged: ResolvedParameters = { ...sources.userDefault };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.meetingType !== undefined) merged.meetingType = layer.meetingType;
    if (layer.durationMinutes !== undefined) merged.durationMinutes = layer.durationMinutes;
    if (layer.format !== undefined) merged.format = layer.format;
  }
  return merged;
}

/** duration for a meeting type when nothing more specific applies */
export function presetDuration(meetingType: MeetingType): number {
  return MEETING_PRESET_DURATIONS[meetingType];
}

const DURATION_RE = /^(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)$/i;

const TYPE_MODIFIERS: Record<string, MeetingType> = {
  coffee: "coffee",
  lunch: "lunch",
  dinner: "dinner",
  "catch up": "catch_up",
  "quick call": "quick_call",
  call: "quick_call",
};

const FORMAT_MODIFIERS: Record<string, MeetingFormat> = {
  virtual: "virtual",
  zoom: "virtual",
  meet: "virtual",
  phone: "phone",
  "in person": "in_person",
};

export type TriggerModifiers = {
  meetingType?: MeetingType;
  durationMinutes?: number;
  format?: MeetingFormat;
  dateHint?: string;
  followUpPolicy?: "until_scheduled" | "none";
  bundleSize?: number;
};

/**
 * parse the text after the trigger emoji, e.g. "30m", "coffee", "next week",
 * "handle 3", "follow up until scheduled", "no follow ups".
 */
export function parseTriggerModifiers(afterTrigger: string): TriggerModifiers {
  const text = afterTrigger.trim().toLowerCase();
  const out: TriggerModifiers = {};
  if (!text) return out;

  const duration = text.match(DURATION_RE);
  if (duration) {
    const n = Number(duration[1]);
    const unit = duration[2]!.toLowerCase();
    out.durationMinutes = unit.startsWith("h") ? n * 60 : n;
    return out;
  }
  if (text === "1h" || text === "1hr") {
    out.durationMinutes = 60;
    return out;
  }

  const type = TYPE_MODIFIERS[text];
  if (type) {
    out.meetingType = type;
    out.durationMinutes = MEETING_PRESET_DURATIONS[type];
    return out;
  }
  const format = FORMAT_MODIFIERS[text];
  if (format) {
    out.format = format;
    return out;
  }
  if (text === "follow up until scheduled") {
    out.followUpPolicy = "until_scheduled";
    return out;
  }
  if (text === "no follow ups" || text === "no followups") {
    out.followUpPolicy = "none";
    return out;
  }
  const handle = text.match(/^handle\s+(\d)$/);
  if (handle) {
    out.bundleSize = Number(handle[1]);
    return out;
  }
  if (text === "after work") {
    out.dateHint = "after work";
    return out;
  }
  // anything else ("next week", "tomorrow") is a date hint for the interpreter
  out.dateHint = text;
  return out;
}

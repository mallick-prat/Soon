export {
  extractStyleFeatures,
  ACKNOWLEDGMENT_CANDIDATES,
  type StyleFeatures,
  type TimeFormatHint,
} from "./features.js";
export { styleDirectives } from "./directives.js";
export {
  validateDraftText,
  countSentences,
  type ValidateDraftOptions,
  type DraftValidationResult,
} from "./validate.js";
export {
  captureEditDiff,
  accumulatePreference,
  resetStyleProfile,
  PREFERENCE_ACTIVATION_THRESHOLD,
  type StyleEditSignal,
  type StyleEditSignalKind,
  type StyleProfile,
  type PreferenceState,
} from "./learning.js";

export interface RejectedDraft {
  text: string;
  reason: string;
}

/** every candidate failed post-validation; caller falls back to approve-with-review */
export class NoValidDraftError extends Error {
  readonly rejected: RejectedDraft[];

  constructor(rejected: RejectedDraft[]) {
    super("no candidate draft survived validation");
    this.name = "NoValidDraftError";
    this.rejected = rejected;
  }
}

import GraphemeSplitter from "grapheme-splitter";

let fallbackSplitter: GraphemeSplitter | undefined;

/** unicode-aware grapheme cluster split; Intl.Segmenter with grapheme-splitter fallback */
export function splitGraphemes(input: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(input), (s) => s.segment);
  }
  fallbackSplitter ??= new GraphemeSplitter();
  return fallbackSplitter.splitGraphemes(input);
}

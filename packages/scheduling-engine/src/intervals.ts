/**
 * pure interval math over epoch-millisecond ranges.
 * all scheduling availability is computed here — never by an llm.
 */

export type Interval = {
  /** inclusive, epoch ms */
  start: number;
  /** exclusive, epoch ms */
  end: number;
};

export function isValid(i: Interval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.start < i.end;
}

/** sort by start and merge overlapping/touching intervals */
export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter(isValid)
    .slice()
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      last.end = Math.max(last.end, i.end);
    } else {
      out.push({ ...i });
    }
  }
  return out;
}

/** subtract every interval in `busy` from every interval in `free` */
export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  const normBusy = normalize(busy);
  const out: Interval[] = [];
  for (const f of normalize(free)) {
    let cursor = f.start;
    for (const b of normBusy) {
      if (b.end <= cursor) continue;
      if (b.start >= f.end) break;
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, f.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}

/** intersect two sets of intervals */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const na = normalize(a);
  const nb = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    const x = na[i]!;
    const y = nb[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start < end) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** expand each interval by the given margins (used for buffers) */
export function pad(intervals: Interval[], beforeMs: number, afterMs: number): Interval[] {
  return normalize(intervals.map((i) => ({ start: i.start - beforeMs, end: i.end + afterMs })));
}

export function durationMs(i: Interval): number {
  return i.end - i.start;
}

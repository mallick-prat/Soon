import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { intersect, normalize, overlaps, pad, subtract, type Interval } from "./intervals.js";

const arbInterval = fc
  .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 10_000 }))
  .map(([start, len]) => ({ start, end: start + len }));

const arbIntervals = fc.array(arbInterval, { maxLength: 20 });

describe("normalize", () => {
  it("merges overlapping and touching intervals", () => {
    expect(
      normalize([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
        { start: 15, end: 20 },
        { start: 30, end: 40 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it("drops invalid intervals", () => {
    expect(normalize([{ start: 10, end: 5 }])).toEqual([]);
  });

  it("always produces sorted, disjoint output", () => {
    fc.assert(
      fc.property(arbIntervals, (xs) => {
        const out = normalize(xs);
        for (let i = 1; i < out.length; i++) {
          expect(out[i]!.start).toBeGreaterThan(out[i - 1]!.end);
        }
      }),
    );
  });
});

describe("subtract", () => {
  it("removes busy time from free windows", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 100 },
    ]);
  });

  it("handles busy fully covering free", () => {
    expect(subtract([{ start: 10, end: 20 }], [{ start: 0, end: 100 }])).toEqual([]);
  });

  it("result never overlaps any busy interval (property)", () => {
    fc.assert(
      fc.property(arbIntervals, arbIntervals, (free, busy) => {
        const out = subtract(free, busy);
        for (const o of out) {
          for (const b of normalize(busy)) {
            expect(overlaps(o, b)).toBe(false);
          }
        }
      }),
    );
  });

  it("result is always contained in the original free set (property)", () => {
    fc.assert(
      fc.property(arbIntervals, arbIntervals, (free, busy) => {
        const out = subtract(free, busy);
        const normFree = normalize(free);
        for (const o of out) {
          expect(normFree.some((f) => f.start <= o.start && o.end <= f.end)).toBe(true);
        }
      }),
    );
  });
});

describe("intersect", () => {
  it("intersects overlapping sets", () => {
    expect(
      intersect(
        [{ start: 0, end: 50 }],
        [
          { start: 25, end: 75 },
          { start: 90, end: 95 },
        ],
      ),
    ).toEqual([{ start: 25, end: 50 }]);
  });

  it("is commutative (property)", () => {
    fc.assert(
      fc.property(arbIntervals, arbIntervals, (a, b) => {
        expect(intersect(a, b)).toEqual(intersect(b, a));
      }),
    );
  });
});

describe("pad", () => {
  it("expands and merges", () => {
    const busy: Interval[] = [
      { start: 100, end: 200 },
      { start: 220, end: 300 },
    ];
    expect(pad(busy, 10, 15)).toEqual([{ start: 90, end: 315 }]);
  });
});

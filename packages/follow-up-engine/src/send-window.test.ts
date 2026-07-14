import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toZonedTime } from "date-fns-tz";
import { adjustForSendWindow } from "./send-window.js";

const TZ = "america/new_york";
const QUIET = { earliest: "09:00", latest: "19:00" };

describe("adjustForSendWindow", () => {
  it("returns the identical instant when inside the window", () => {
    // tuesday 2026-07-14 10:30 edt
    const instant = new Date("2026-07-14T14:30:00.123Z");
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toBe(instant);
  });

  it("keeps the window-open boundary (exactly 09:00)", () => {
    const instant = new Date("2026-07-14T13:00:00.000Z"); // 09:00 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toBe(instant);
  });

  it("defers early morning to the same day 09:00", () => {
    const instant = new Date("2026-07-14T12:59:00.000Z"); // 08:59 edt tuesday
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-14T13:00:00.000Z"),
    );
  });

  it("defers exactly 19:00 to the next day 09:00 (latest is exclusive)", () => {
    const instant = new Date("2026-07-14T23:00:00.000Z"); // 19:00 edt tuesday
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-15T13:00:00.000Z"),
    );
  });

  it("wraps a 22:30 evening send to the next day 09:00", () => {
    const instant = new Date("2026-07-15T02:30:00.000Z"); // tuesday 22:30 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-15T13:00:00.000Z"), // wednesday 09:00 edt
    );
  });

  it("keeps 18:59 unchanged", () => {
    const instant = new Date("2026-07-14T22:59:00.000Z"); // 18:59 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toBe(instant);
  });

  it("defers saturday to monday 09:00 when weekends are disabled", () => {
    const instant = new Date("2026-07-18T15:00:00.000Z"); // saturday 11:00 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-20T13:00:00.000Z"), // monday 09:00 edt
    );
  });

  it("defers sunday to monday 09:00 when weekends are disabled", () => {
    const instant = new Date("2026-07-19T15:00:00.000Z"); // sunday 11:00 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-20T13:00:00.000Z"),
    );
  });

  it("allows saturday inside the window when weekends are enabled", () => {
    const instant = new Date("2026-07-18T15:00:00.000Z"); // saturday 11:00 edt
    expect(adjustForSendWindow(instant, QUIET, true, TZ)).toBe(instant);
  });

  it("rolls friday 22:30 over the whole weekend to monday 09:00", () => {
    const instant = new Date("2026-07-18T02:30:00.000Z"); // friday 22:30 edt
    expect(adjustForSendWindow(instant, QUIET, false, TZ)).toEqual(
      new Date("2026-07-20T13:00:00.000Z"),
    );
  });

  it("keeps 09:00 wall-clock across the spring-forward dst transition", () => {
    // monday before dst: 2026-03-02 08:00 est (utc-5)
    const beforeDst = new Date("2026-03-02T13:00:00.000Z");
    expect(adjustForSendWindow(beforeDst, QUIET, false, TZ)).toEqual(
      new Date("2026-03-02T14:00:00.000Z"), // 09:00 est
    );
    // monday after the 2026-03-08 spring forward: 08:00 edt (utc-4)
    const afterDst = new Date("2026-03-09T12:00:00.000Z");
    expect(adjustForSendWindow(afterDst, QUIET, false, TZ)).toEqual(
      new Date("2026-03-09T13:00:00.000Z"), // 09:00 edt
    );
  });

  it("defers correctly on the spring-forward day itself", () => {
    // sunday 2026-03-08 01:30 est, one hour of the day is about to vanish
    const instant = new Date("2026-03-08T06:30:00.000Z");
    expect(adjustForSendWindow(instant, QUIET, true, TZ)).toEqual(
      new Date("2026-03-08T13:00:00.000Z"), // 09:00 edt — offset already shifted
    );
  });

  it("property: result is never earlier and always lands inside the window", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2026-01-01T00:00:00.000Z"),
          max: new Date("2026-12-31T00:00:00.000Z"),
          noInvalidDate: true,
        }),
        fc.boolean(),
        (instant, weekendsEnabled) => {
          const result = adjustForSendWindow(instant, QUIET, weekendsEnabled, TZ);
          expect(result.getTime()).toBeGreaterThanOrEqual(instant.getTime());
          const zoned = toZonedTime(result, TZ);
          const wallMinutes = zoned.getHours() * 60 + zoned.getMinutes();
          expect(wallMinutes).toBeGreaterThanOrEqual(9 * 60);
          expect(wallMinutes).toBeLessThan(19 * 60);
          if (!weekendsEnabled) {
            expect([0, 6]).not.toContain(zoned.getDay());
          }
        },
      ),
    );
  });
});

import { describe, expect, it } from "vitest";
import { pauseEndedBy, resumedStart, sessionElapsed } from "./pause";

const START = "2026-10-07T17:00:00.000Z";
const at = (minutes: number, seconds = 0) =>
  new Date(Date.parse(START) + minutes * 60_000 + seconds * 1000).toISOString();

describe("sessionElapsed", () => {
  it("counts from the start while the session runs", () => {
    expect(sessionElapsed(START, null, Date.parse(at(12, 6)))).toBe(726_000);
    expect(sessionElapsed(START, undefined, Date.parse(at(1)))).toBe(60_000);
  });

  it("stands still from the pause, however long it lasts", () => {
    expect(sessionElapsed(START, at(12, 6), Date.parse(at(12, 6)))).toBe(726_000);
    expect(sessionElapsed(START, at(12, 6), Date.parse(at(95)))).toBe(726_000);
  });

  it("never reads below zero", () => {
    expect(sessionElapsed(START, null, Date.parse(at(-1)))).toBe(0);
    // A start moved later by another device than this device's pause.
    expect(sessionElapsed(at(10), at(5), Date.parse(at(20)))).toBe(0);
  });
});

describe("resumedStart", () => {
  it("moves the start later by the time paused", () => {
    expect(resumedStart(START, at(20), at(27, 30))).toBe(at(7, 30));
  });

  it("counts a pause that began before a start moved by another device from that start", () => {
    // Paused at 17:05 here, the start moved to 17:10 elsewhere, resumed at 17:15.
    expect(resumedStart(at(10), at(5), at(15))).toBe(at(15));
    expect(resumedStart(at(10), at(5), at(12))).toBe(at(12));
  });

  it("leaves the start alone when the clock went back during the pause", () => {
    expect(resumedStart(START, at(30), at(20))).toBe(START);
  });

  it("never moves the start past the moment of the resume", () => {
    // The start moved past this device's resume: the change keeps a start no later than itself.
    expect(resumedStart(at(10), at(5), at(7))).toBe(at(7));
  });
});

describe("pauseEndedBy", () => {
  it("is the first set logged after the pause began", () => {
    expect(pauseEndedBy(at(20), [at(3), at(26), at(22), at(19)])).toBe(at(22));
  });

  it("is null while no set came after the pause", () => {
    expect(pauseEndedBy(at(20), [at(3), at(19), at(20)])).toBeNull();
    expect(pauseEndedBy(at(20), [])).toBeNull();
  });
});

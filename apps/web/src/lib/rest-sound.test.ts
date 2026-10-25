import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the browser's audio context: it records what would sound, and starts locked as a
// phone's does until a tap resumes it.
class FakeContext extends EventTarget {
  static made: FakeContext[] = [];
  state: AudioContextState | "interrupted" = "suspended";
  currentTime = 10;
  sampleRate = 48_000;
  destination = {};
  resumes = 0;
  silent = 0;
  notes: { frequency: number; start: number; stop: number; gain: [string, number, number][] }[] =
    [];
  // Whether a resume runs it: a page with no gesture stays locked.
  unlocks = true;
  constructor() {
    super();
    FakeContext.made.push(this);
  }
  resume() {
    this.resumes++;
    if (this.unlocks) this.move("running");
    return Promise.resolve();
  }
  move(state: FakeContext["state"]) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return {
      buffer: null,
      connect: () => {},
      start: () => {
        this.silent++;
      },
    };
  }
  createGain() {
    const gain: [string, number, number][] = [];
    const record =
      (name: string) =>
      (value: number, time: number): void => {
        gain.push([name, value, time]);
      };
    return {
      gain: {
        setValueAtTime: record("set"),
        linearRampToValueAtTime: record("linear"),
        exponentialRampToValueAtTime: record("exponential"),
      },
      connect: (to: unknown) => to,
      record: gain,
    };
  }
  createOscillator() {
    const note = { frequency: 0, start: -1, stop: -1, gain: [] as [string, number, number][] };
    return {
      type: "",
      frequency: {
        set value(v: number) {
          note.frequency = v;
        },
      },
      connect: (to: { record: [string, number, number][] }) => {
        note.gain = to.record;
        return to;
      },
      start: (at: number) => {
        note.start = at;
        this.notes.push(note);
      },
      stop: (at: number) => {
        note.stop = at;
      },
    };
  }
}

type Sound = typeof import("./rest-sound");
let sound: Sound;
const END = "2026-10-05T17:01:30.000Z";
const end = Date.parse(END);
const context = () => FakeContext.made[0]!;

// The module keeps its context and the ends it played: a fresh copy for each test.
beforeEach(async () => {
  FakeContext.made = [];
  vi.stubGlobal("AudioContext", FakeContext);
  localStorage.clear();
  vi.resetModules();
  sound = await import("./rest-sound");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "audioSession");
  Reflect.deleteProperty(document, "visibilityState");
});

// The preference on and the context unlocked by a tap, as on the session screen.
function unlocked() {
  sound.setRestSound("on");
  const disarm = sound.armRestSound();
  document.dispatchEvent(new Event("pointerup"));
  return disarm;
}

describe("the end-of-rest sound", () => {
  it("off by default and creates no audio context", () => {
    expect(sound.readRestSound()).toBe("off");
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", { value: audioSession, configurable: true });
    const disarm = sound.armRestSound();
    document.dispatchEvent(new Event("pointerup"));
    document.dispatchEvent(new KeyboardEvent("keydown"));
    expect(sound.restEnded(END, end + 100)).toBe(false);
    disarm();
    expect(FakeContext.made).toHaveLength(0);
    expect(audioSession.type).toBe("auto");
  });

  it("the choice holds for the visit when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    sound.setRestSound("on");
    expect(sound.readRestSound()).toBe("on");
  });

  it("a tap unlocks audio and the listeners go once it runs", () => {
    sound.setRestSound("on");
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const disarm = sound.armRestSound();
    expect(add.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["pointerup", { capture: true }],
      ["touchend", { capture: true }],
      ["click", { capture: true }],
      ["keydown", { capture: true }],
    ]);
    // Nothing made before the gesture: a context made outside one stays locked on a phone.
    expect(FakeContext.made).toHaveLength(0);
    document.dispatchEvent(new Event("pointerup"));
    expect(FakeContext.made).toHaveLength(1);
    expect(context().state).toBe("running");
    expect(context().silent).toBe(1);
    expect(remove.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["pointerup", { capture: true }],
      ["touchend", { capture: true }],
      ["click", { capture: true }],
      ["keydown", { capture: true }],
    ]);
    // Gone: another tap resumes nothing.
    document.dispatchEvent(new KeyboardEvent("keydown"));
    expect(context().resumes).toBe(1);
    disarm();
  });

  it("a key press unlocks it too, and a second arming shares the one context", () => {
    sound.setRestSound("on");
    const first = sound.armRestSound();
    document.dispatchEvent(new KeyboardEvent("keydown"));
    first();
    const second = sound.armRestSound();
    document.dispatchEvent(new Event("pointerup"));
    expect(FakeContext.made).toHaveLength(1);
    second();
  });

  it("an interrupted context arms the listeners again", () => {
    const disarm = unlocked();
    expect(context().resumes).toBe(1);
    // Back from the background, iOS hands the context back interrupted.
    context().move("interrupted");
    document.dispatchEvent(new Event("pointerup"));
    expect(context().resumes).toBe(2);
    expect(context().state).toBe("running");
    document.dispatchEvent(new Event("pointerup"));
    expect(context().resumes).toBe(2);
    // Put away, it listens no more, interrupted or not.
    disarm();
    context().move("suspended");
    document.dispatchEvent(new Event("pointerup"));
    expect(context().resumes).toBe(2);
  });

  it("a rest end plays two notes under 400 ms, once", () => {
    unlocked();
    expect(sound.restEnded(END, end + 120)).toBe(true);
    const t = context().currentTime;
    const notes = context().notes;
    expect(notes.map((n) => n.frequency)).toEqual([880, 1320]);
    expect(notes[0]!.start).toBeCloseTo(t);
    expect(notes[0]!.stop).toBeCloseTo(t + 0.15);
    expect(notes[1]!.start).toBeCloseTo(t + 0.17);
    expect(notes[1]!.stop).toBeCloseTo(t + 0.32);
    expect(notes[1]!.stop - notes[0]!.start).toBeLessThan(0.4);
    const [rise, peak, fall] = notes[0]!.gain;
    expect(rise).toEqual(["set", 0, t]);
    expect(peak![0]).toBe("linear");
    expect(peak![1]).toBe(0.6);
    expect(peak![2]).toBeCloseTo(t + 0.01);
    expect(fall![0]).toBe("exponential");
    expect(fall![1]).toBe(0.001);
    expect(fall![2]).toBeCloseTo(t + 0.15);
  });

  it("the same end seen twice plays once", () => {
    unlocked();
    expect(sound.restEnded(END, end + 10)).toBe(true);
    // The rest bar and the session bar both see it on a route change.
    expect(sound.restEnded(END, end + 300)).toBe(false);
    expect(context().notes).toHaveLength(2);
    // Another rest's end plays again, and so does every one after the twenty kept.
    for (let k = 1; k <= 21; k++) {
      const other = new Date(end + k * 60_000).toISOString();
      expect(sound.restEnded(other, end + k * 60_000)).toBe(true);
    }
    expect(sound.restEnded(END, end + 1000)).toBe(true);
  });

  it("an end seen 2.1 s late plays nothing", () => {
    unlocked();
    expect(sound.FRESH_MS).toBe(2000);
    expect(sound.restEnded(END, end + 2100)).toBe(false);
    // Nor an end not reached yet, nor one that does not parse.
    expect(sound.restEnded(END, end - 1)).toBe(false);
    expect(sound.restEnded("soon", end)).toBe(false);
    expect(context().notes).toHaveLength(0);
    // Exactly at the edge, it still plays.
    expect(sound.restEnded(END, end + 2000)).toBe(true);
  });

  it("a hidden page plays nothing", () => {
    unlocked();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    expect(sound.restEnded(END, end + 10)).toBe(false);
    expect(context().notes).toHaveLength(0);
  });

  it("a locked context plays nothing and throws nothing", () => {
    sound.setRestSound("on");
    // Never unlocked: no context at all.
    expect(sound.restEnded(END, end + 10)).toBe(false);
    // Made, but the browser keeps it suspended.
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        unlocks = false;
      },
    );
    sound.armRestSound();
    document.dispatchEvent(new Event("pointerup"));
    expect(context().state).toBe("suspended");
    expect(sound.restEnded(END, end + 10)).toBe(false);
    expect(context().notes).toHaveLength(0);
    // A browser whose audio fails outright.
    context().state = "running";
    context().createOscillator = () => {
      throw new Error("no audio");
    };
    expect(() => sound.restEnded(END, end + 10)).not.toThrow();
    expect(sound.restEnded(END, end + 20)).toBe(false);
  });

  it("a browser without audio throws nothing on a tap", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.resetModules();
    sound = await import("./rest-sound");
    sound.setRestSound("on");
    sound.armRestSound();
    expect(() => document.dispatchEvent(new Event("pointerup"))).not.toThrow();
    expect(() => sound.previewRestSound()).not.toThrow();
    expect(sound.restEnded(END, end + 10)).toBe(false);
  });

  it("asks for an ambient audio session where the browser has one", () => {
    sound.setRestSound("on");
    expect(() => sound.armRestSound()()).not.toThrow();
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", { value: audioSession, configurable: true });
    sound.armRestSound()();
    expect(audioSession.type).toBe("ambient");
  });

  it("asks for a playback session, through the silent switch, when the sound plays over all", () => {
    sound.setRestSound("over");
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", { value: audioSession, configurable: true });
    sound.armRestSound()();
    expect(audioSession.type).toBe("playback");
    expect(sound.restEnded(new Date(Date.now() - 100).toISOString())).toBe(false); // still locked
  });

  it("previewRestSound plays at once", () => {
    sound.previewRestSound();
    expect(FakeContext.made).toHaveLength(1);
    expect(context().resumes).toBe(1);
    expect(context().notes.map((n) => n.frequency)).toEqual([880, 1320]);
    // A second preview reuses the context and plays again.
    sound.previewRestSound();
    expect(FakeContext.made).toHaveLength(1);
    expect(context().notes).toHaveLength(4);
  });
});

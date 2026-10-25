import { preference } from "./preference";

// A short tone when a rest runs out, for whoever turns it on in Settings. Only lazy screens import
// this module: the session screen, the session bar and Settings, never the startup bundle.
export type RestSound = "off" | "on";
export const [readRestSound, setRestSound] = preference<RestSound>("belay.restSound", "off", "on");

// A rest end seen later than this (timers held back in the background, a reload past the end)
// stays silent: a tone long after the fact would only startle.
export const FRESH_MS = 2000;

// The ends already played, so the rest bar and the session bar never sound one end twice. Twenty
// is far more rests than a route change can bring together.
const PLAYED_KEPT = 20;
const played: string[] = [];

// One context for the visit, made on a gesture: a phone keeps one made outside a gesture locked.
let context: AudioContext | null = null;

// Not in TypeScript's DOM types yet; Safari has it, other browsers leave it out.
type WithAudioSession = Navigator & { audioSession?: { type: string } };

// « ambient » mixes with the person's music and follows the iPhone's silent switch.
function askAmbient() {
  const session = (navigator as WithAudioSession).audioSession;
  if (session) session.type = "ambient";
}

// Makes or resumes the context. Audio is a nicety here: a browser that refuses it gets silence,
// never an error in the person's way, so a failure is left as no context.
function wake(): AudioContext | null {
  try {
    askAmbient();
    context ??= new AudioContext();
    if (context.state !== "running") context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

// A one-sample silent buffer started inside the gesture: iOS unlocks a context only once
// something has played in one.
function playSilence(audio: AudioContext) {
  const source = audio.createBufferSource();
  source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
  source.connect(audio.destination);
  source.start();
}

function note(audio: AudioContext, frequency: number, start: number, end: number) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.6, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(end);
}

// Two notes a fifth apart, 320 ms in all.
function tone(audio: AudioContext) {
  const t = audio.currentTime;
  note(audio, 880, t, t + 0.15);
  note(audio, 1320, t + 0.17, t + 0.32);
}

// While the sound is on, the first tap or key press unlocks the audio. iOS counts a finger's lift,
// not its press, as the gesture that may start sound: listening on the press alone left the audio
// locked after a reload or a lock, unless another tap had come within the last few seconds. The listeners go once the
// context runs and come back when it stops running (iOS interrupts it in the background).
export function armRestSound(): () => void {
  if (readRestSound() !== "on") return () => {};
  askAmbient();
  const options = { capture: true };
  let listening = false;
  let watched: AudioContext | null = null;
  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    for (const type of ["pointerup", "touchend", "click", "keydown"] as const) {
      if (on) document.addEventListener(type, unlock, options);
      else document.removeEventListener(type, unlock, options);
    }
  };
  const follow = () => listen(watched?.state !== "running");
  const watch = (audio: AudioContext) => {
    if (watched !== audio) {
      watched = audio;
      audio.addEventListener("statechange", follow);
    }
    follow();
  };
  function unlock() {
    const audio = wake();
    if (!audio) return;
    try {
      playSilence(audio);
    } catch {
      // As in wake: silence rather than an error.
    }
    watch(audio);
  }
  if (context) watch(context);
  else listen(true);
  return () => {
    watched?.removeEventListener("statechange", follow);
    listen(false);
  };
}

// The end of a running rest, from the rest bar or the session bar: plays the tone once for that
// end when the sound is on, the page shown, the end fresh and the audio unlocked. Says whether it
// played.
export function restEnded(endsAt: string, now = Date.now()): boolean {
  try {
    if (readRestSound() !== "on" || document.visibilityState !== "visible") return false;
    const late = now - Date.parse(endsAt);
    if (!(late >= 0 && late <= FRESH_MS)) return false;
    if (context?.state !== "running" || played.includes(endsAt)) return false;
    played.push(endsAt);
    if (played.length > PLAYED_KEPT) played.shift();
    tone(context);
    return true;
  } catch {
    // Locked or failing audio plays nothing and shows nothing; where the phone has it (not an
    // iPhone), the vibration still comes.
    return false;
  }
}

// Settings plays the tone when the sound is turned on: the tap is the gesture that unlocks it.
export function previewRestSound(): void {
  const audio = wake();
  if (!audio) return;
  try {
    tone(audio);
  } catch {
    // As in wake: silence rather than an error.
  }
}

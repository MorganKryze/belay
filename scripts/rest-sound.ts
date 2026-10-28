// Writes the rest-end tone the iPhone app's notification plays, as a WAV file bundled with the app.
// It is the same sound the web app plays in the browser (apps/web/src/lib/rest-sound.ts): two sine
// notes a fifth apart, each rising to 0.6 in 10 ms then fading exponentially to 0.001 at its end.
// Run by hand after changing the tone, then commit the output.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const LENGTH = 0.32;
const NOTES = [
  { frequency: 880, start: 0, end: 0.15 },
  { frequency: 1320, start: 0.17, end: 0.32 },
];
const RISE = 0.01;
const PEAK = 0.6;
const FLOOR = 0.001;

// The envelope of Web Audio's linear then exponential ramps, at `t` seconds into the note.
function gain(t: number, length: number): number {
  if (t < RISE) return (PEAK * t) / RISE;
  return PEAK * (FLOOR / PEAK) ** ((t - RISE) / (length - RISE));
}

const count = Math.round(LENGTH * RATE);
const samples = new Float64Array(count);
for (const { frequency, start, end } of NOTES) {
  const first = Math.round(start * RATE);
  const last = Math.min(Math.round(end * RATE), count);
  for (let i = first; i < last; i++) {
    const t = (i - first) / RATE;
    samples[i] = gain(t, end - start) * Math.sin(2 * Math.PI * frequency * t);
  }
}

// RIFF/WAVE, PCM 16-bit mono: a 44-byte header, then the samples little-endian.
const data = count * 2;
const wav = Buffer.alloc(44 + data);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + data, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(data, 40);
samples.forEach((sample, i) => {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
});

const target = fileURLToPath(new URL("../apps/mobile/ios/App/App/rest.wav", import.meta.url));
writeFileSync(target, wav);
console.log(`Wrote ${target} (${wav.length} bytes).`);

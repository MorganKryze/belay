import "@/i18n/lazy";
import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cardSurface } from "@/components/surfaces";
import { useLoop } from "@/lib/media";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// An exercise's demonstration loop: a square card, muted, looping, never with the player's own
// controls. Nothing shows until its first frame is ready, and a loop that fails leaves without a
// word. One button pauses it and plays it again; with reduced motion it waits on its first frame.
export function ExerciseLoop({
  exerciseId,
  name,
  centred = false,
}: {
  exerciseId: string;
  name: string; // the exercise's, which names the card for assistive technologies
  centred?: boolean; // in a sheet wider than the loop's desktop cap; a page keeps it on the left
}) {
  const { t } = useTranslation();
  const { src, failed } = useLoop(exerciseId);
  const video = useRef<HTMLVideoElement>(null);
  const [reduced] = useState(reducedMotion);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  if (!src) return null;

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    // The button does what it says: its name follows the video's own play and pause events.
    if (playing) v.pause();
    else void v.play()?.catch(() => undefined);
  };

  return (
    <figure
      aria-label={t("loop.name", { name })}
      hidden={!ready}
      className={`${cardSurface} relative aspect-square w-full overflow-hidden lg:max-w-90 ${centred ? "lg:mx-auto" : ""}`}
    >
      {/* The fragment makes iOS draw the first frame without playing; it never reaches the
          server or the cache. */}
      <video
        ref={video}
        src={`${src}#t=0.001`}
        muted
        playsInline
        loop
        preload="auto"
        autoPlay={!reduced}
        aria-hidden
        className="size-full object-cover"
        onLoadedData={() => setReady(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={failed}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={t(playing ? "loop.pause" : "loop.play")}
        className="press absolute right-2.5 bottom-2.5 grid size-11 place-items-center rounded-round glass text-foreground ring-1 ring-border"
      >
        {playing ? (
          <Pause aria-hidden className="size-5" />
        ) : (
          <Play aria-hidden className="size-5" />
        )}
      </button>
    </figure>
  );
}

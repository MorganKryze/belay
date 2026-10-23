import { type ReactNode, useState } from "react";
import { useLoop } from "@/lib/media";

// An exercise row's still: the first frame of its loop, cropped to the centre of a 44 px square,
// never played and hidden from assistive technologies. The fallback holds the same place while
// there is no loop, before the frame is ready and after a failure.
export function LoopThumb({ exerciseId, fallback }: { exerciseId: string; fallback: ReactNode }) {
  const { src, failed } = useLoop(exerciseId);
  const [ready, setReady] = useState(false);
  const shown = src !== null && ready;
  return (
    <span className="grid size-11 shrink-0 place-items-center">
      {!shown && fallback}
      {src && (
        // The fragment makes iOS draw the first frame without playing it.
        <video
          src={`${src}#t=0.001`}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          hidden={!ready}
          className="size-11 rounded-[10px] bg-track object-cover"
          onLoadedData={() => setReady(true)}
          onError={failed}
        />
      )}
    </span>
  );
}

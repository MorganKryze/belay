import { toISODate } from "@belay/shared/body/dates";
import { useEffect, useState } from "react";

// The person's calendar day, kept current: a phone that left the app open overnight must not
// file the morning weigh-in under yesterday.
export function useToday(): string {
  const [today, setToday] = useState(() => toISODate(new Date()));
  useEffect(() => {
    const refresh = () => setToday(toISODate(new Date()));
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const minute = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(minute);
    };
  }, []);
  return today;
}

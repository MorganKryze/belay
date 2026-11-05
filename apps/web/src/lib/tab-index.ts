// The one place that says which tab a page belongs to. An exercise belongs to Séances, whose
// library opens it; every tool page to Outils. The session cover ("/workout") is in no tab. A
// session's preview opened from Accueil stays Accueil's.
export function tabIndexOf(pathname: string, search?: { from?: unknown }): 0 | 1 | 2 | 3 | null {
  if (pathname === "/") return 0;
  if (search?.from === "home" && /^\/workouts\/session\/[^/]+$/.test(pathname)) return 0;
  if (/^\/(?:workouts(?:\/|$)|exercises\/)/.test(pathname)) return 1;
  if (/^\/body(?:\/|$)/.test(pathname)) return 2;
  if (/^\/tools(?:\/|$)/.test(pathname)) return 3;
  return null;
}

// Repeats isDark() from src/lib/theme.ts: it runs before the bundle. Ceiling: the copies can
// drift. Upgrade: generate it from theme.ts at build time.
{
  let t;
  try {
    t = localStorage.getItem("belay.theme");
  } catch {}
  document.documentElement.classList.toggle(
    "dark",
    t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches),
  );
}

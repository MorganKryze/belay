// Repeats isDark() from src/lib/theme.ts: it runs before the bundle. Ceiling: the copies can
// drift. Upgrade: generate it from theme.ts at build time.
{
  let t;
  try {
    t = localStorage.getItem("belay.theme");
  } catch {}
  const dark = (prefers) => t === "dark" || (t !== "light" && prefers);
  document.documentElement.classList.toggle(
    "dark",
    dark(matchMedia("(prefers-color-scheme: dark)").matches),
  );
  // The browser bar follows a chosen theme from the first paint, whatever the phone's scheme.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
    meta.setAttribute(
      "content",
      dark((meta.getAttribute("media") || "").includes("dark")) ? "#151412" : "#FAFAF7",
    );
}

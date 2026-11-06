// Repeats isDark() and the colours from src/lib/theme.ts: it runs before the bundle. Ceiling: the
// copies can drift, though theme.test.ts fails if the colours do. Upgrade: generate it from
// theme.ts at build time.
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
      dark((meta.getAttribute("media") || "").includes("dark")) ? "#10151A" : "#F3F5F5",
    );
  // The apps' pages get their platform and text size from the first paint (the launch screen does).
  const c = globalThis.Capacitor;
  if (c?.isNativePlatform?.()) {
    const r = document.documentElement;
    r.dataset.platform = c.getPlatform();
    // The Android web view does not pass the system's increased contrast on; its shell reports it.
    if (globalThis.BelayText?.contrast?.()) r.dataset.contrast = "more";
    let k = globalThis.BelayText?.scale();
    r.style.font = "-apple-system-body";
    if (r.style.font) k = parseFloat(getComputedStyle(r).fontSize) / 17;
    r.style.font = "";
    if (isFinite(k) && k > 0) {
      r.style.setProperty("--text-scale", k);
      r.toggleAttribute("data-text-scaled", k !== 1);
    }
  }
}

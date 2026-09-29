// ponytail: duplicates isDark() from src/lib/theme.ts on purpose — it must run before the bundle loads.
// Ceiling: the two copies can drift apart. Upgrade: a test that runs this script in jsdom against
// the isDark matrix, or generate it from theme.ts at build time.
(function () {
  var t;
  try {
    t = localStorage.getItem("belay.theme");
  } catch (e) {}
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();

/* Runs before styles are painted to avoid flashing the wrong theme. */
(() => {
  const key = "ruxi-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let mode = "light";
  try {
    mode = localStorage.getItem(key) || "light";
  } catch {}
  if (!["light", "dark", "system"].includes(mode)) mode = "light";
  function apply() {
    const resolved =
      mode === "system" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#151718" : "#f4f6f5");
    window.dispatchEvent(
      new CustomEvent("ruxi-theme-change", { detail: { mode, resolved } }),
    );
  }
  window.RuxiTheme = {
    get: () => mode,
    set: (value) => {
      if (!["light", "dark", "system"].includes(value)) return;
      mode = value;
      try {
        localStorage.setItem(key, mode);
      } catch {}
      apply();
    },
  };
  media.addEventListener("change", () => {
    if (mode === "system") apply();
  });
  apply();
})();

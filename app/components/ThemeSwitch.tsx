"use client";
import { useEffect, useState } from "react";
import { IconAuto, IconMoon, IconSun } from "./icons";

type Theme = "dark" | "light" | "system";
const KEY = "kargo-theme";
const OPTIONS: Array<[Theme, string, () => React.JSX.Element]> = [["dark", "Dark", IconMoon], ["light", "Light", IconSun], ["system", "Match system", IconAuto]];

/** Dark / Light / System. The choice is remembered in this browser; first-time visitors get dark. */
export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = document.documentElement.dataset.theme as Theme | undefined;
    if (t === "dark" || t === "light" || t === "system") setTheme(t);
  }, []);
  function choose(t: Theme) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice just won't persist */ }
  }
  return (
    <div className="g-theme" role="group" aria-label="Colour theme">
      {OPTIONS.map(([key, label, Icon]) => (
        <button key={key} aria-pressed={theme === key} aria-label={label} title={label} onClick={() => choose(key)}><Icon /></button>
      ))}
    </div>
  );
}

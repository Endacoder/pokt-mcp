"use client";

import { useEffect } from "react";
import { applyTheme, type ThemeMode } from "../lib/theme";

/** Prevent flash of wrong theme — runs before React hydrates via inline script in layout. */
export function ThemeScript() {
  const script = `(function(){try{var s=JSON.parse(localStorage.getItem("pokt-mcp-settings")||"{}");var t=s.theme||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export function ThemeSync({ theme }: { theme: ThemeMode }) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}

// Minimal history-API router: direct URLs, refresh and back/forward all work (the server serves
// index.html for unknown paths). No dependency added.
import { useEffect, useState, type MouseEvent } from "react";

type NavigationOptions = { replace?: boolean; returnTo?: string };

export function navigate(to: string, { replace = false, returnTo }: NavigationOptions = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](returnTo ? { returnTo } : null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

export function goBack(fallback: string) {
  if (history.state?.returnTo === fallback) history.back();
  else navigate(fallback, { replace: true });
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return loc;
}

// Let modified clicks (new tab, etc.) behave natively; plain clicks navigate in-app.
function followLink(action: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    action();
  };
}

export const linkClick = (to: string, options?: NavigationOptions) => followLink(() => navigate(to, options));
export const backLinkClick = (fallback: string) => followLink(() => goBack(fallback));

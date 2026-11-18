import { useCallback, useEffect, useState } from "react";
import {
  pageHash,
  parseHash,
  settingsHash,
  type Page,
  type SettingsSection,
} from "./routes";

export type RouteState = {
  /** The page underneath; it stays put while settings is open over it. */
  page: Page;
  settings: SettingsSection | null;
};

const HOME: Page = { name: "loop", sessionId: null };

function initialState(): RouteState {
  const parsed = parseHash(location.hash);
  if (parsed.kind === "page") return { page: parsed.page, settings: null };
  if (parsed.kind === "settings") {
    return { page: HOME, settings: parsed.section };
  }
  return { page: HOME, settings: null };
}

export function useRoute() {
  const [state, setState] = useState<RouteState>(initialState);

  useEffect(() => {
    const sync = () => {
      const parsed = parseHash(location.hash);
      if (parsed.kind === "redirect") {
        // replace() so the legacy hash does not stay in history as a back-button trap.
        location.replace(parsed.to);
        return;
      }
      setState((prev) =>
        parsed.kind === "page"
          ? { page: parsed.page, settings: null }
          : { page: prev.page, settings: parsed.section },
      );
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const goPage = useCallback((page: Page) => {
    location.hash = pageHash(page);
  }, []);

  const openSettings = useCallback((section: SettingsSection) => {
    location.hash = settingsHash(section);
  }, []);

  const closeSettings = useCallback(() => {
    location.hash = pageHash(state.page);
  }, [state.page]);

  return { ...state, goPage, openSettings, closeSettings };
}

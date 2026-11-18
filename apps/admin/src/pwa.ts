import { useSyncExternalStore } from "react";

/** Chromium's pre-`navigator.install()` install event; not in lib.dom. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallCapableNavigator = Navigator & { install?: () => Promise<unknown> };

export type InstallState = "standalone" | "available" | "unavailable";
export type InstallOutcome = "installed" | "dismissed" | "failed";

const supportsWebInstall =
  typeof Navigator !== "undefined" &&
  typeof (Navigator.prototype as InstallCapableNavigator).install === "function";

const standaloneQuery =
  typeof matchMedia === "function"
    ? matchMedia("(display-mode: standalone)")
    : null;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function readState(): InstallState {
  if (standaloneQuery?.matches) return "standalone";
  if (installed) return "unavailable";
  return supportsWebInstall || deferredPrompt ? "available" : "unavailable";
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Called once at startup, before React renders: `beforeinstallprompt` can fire
 * long before the settings panel that shows the install button is ever opened.
 */
export function initPwa() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
  standaloneQuery?.addEventListener("change", notify);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
        console.warn("SightLoop: service worker registration failed", err);
      });
    });
  }
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, readState);
}

/** Must be called directly from a click handler: both paths need user activation. */
export async function promptInstall(): Promise<InstallOutcome> {
  try {
    if (supportsWebInstall) {
      await (navigator as InstallCapableNavigator).install?.();
      installed = true;
      notify();
      return "installed";
    }
    if (!deferredPrompt) return "failed";
    // The event is single-use: drop it before awaiting the user's choice.
    const prompt = deferredPrompt;
    deferredPrompt = null;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") installed = true;
    notify();
    return outcome === "accepted" ? "installed" : "dismissed";
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return "dismissed";
    console.error("SightLoop: install failed", err);
    return "failed";
  }
}

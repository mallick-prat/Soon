/**
 * optional global shortcut — used ONLY for an explicitly-configured
 * binding (e.g. "open review window from anywhere"). never registered
 * by default, and never for ⌘return (that is window-scoped, see
 * src/approvals/window.ts). unregister when the owning window closes.
 */
import { globalShortcut } from "electron";

export interface GlobalShortcutHandle {
  accelerator: string;
  unregister(): void;
}

export const registerConfiguredGlobalShortcut = (
  accelerator: string | undefined,
  callback: () => void,
): GlobalShortcutHandle | undefined => {
  if (accelerator === undefined || accelerator.trim() === "") return undefined;
  // ⌘return must remain window-scoped; refuse it here.
  const normalized = accelerator.replaceAll(" ", "").toLowerCase();
  if (normalized === "cmd+return" || normalized === "command+return" || normalized === "cmd+enter") {
    return undefined;
  }
  const ok = globalShortcut.register(accelerator, callback);
  if (!ok) return undefined;
  return {
    accelerator,
    unregister: () => globalShortcut.unregister(accelerator),
  };
};

export const unregisterAllGlobalShortcuts = (): void => {
  globalShortcut.unregisterAll();
};

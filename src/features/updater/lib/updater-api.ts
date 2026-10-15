import { invoke } from "@tauri-apps/api/core";

export interface UpdateStatus {
  available: boolean;
  version: string | null;
  currentVersion: string;
}

/** Snapshot for UI hydration on mount. `phase`: "idle" | "downloading" | "ready". */
export interface UpdaterSnapshot {
  phase: string;
  version: string | null;
  currentVersion: string;
}

export const updater = {
  /** Manual "Check for updates" — bypasses the auto-update/ignored gates. */
  checkNow: () => invoke<UpdateStatus>("update_check_now"),
  /** Current updater state (for hydrating the UI on mount). */
  state: () => invoke<UpdaterSnapshot>("update_state"),
  /** Restart now: swap the staged update in and relaunch. */
  apply: () => invoke<void>("update_apply"),
  /** Persist "don't prompt for this version again". */
  ignore: (version: string) => invoke<void>("update_ignore", { version }),
};

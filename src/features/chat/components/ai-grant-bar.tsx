import { useCallback, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Check, Cloud, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { useOrgStore } from "@/features/organisations/stores/org-store";
import { isLocalOrg, useActiveOrganisation, useAiGrantStore } from "../stores/ai-grant-store";

/**
 * The native agent's no-grant setup state (spec D15a, acceptance bar item 14).
 *
 * A signed-in user whose organisation has no AI grant is not having a failure,
 * they are having a **setup problem** — the gateway's own words. Shown as an
 * error it reads as something broken, and they go hunting for a switch to flip.
 * There is no such switch; an admin has to grant it, so the bar says that and
 * offers the two things the user *can* do: re-check, or ask to be counted.
 *
 * The composer below it is disabled while this shows (see `message-input.tsx`),
 * so this bar is the explanation for a dead input — which is why the strip is
 * attached to the composer rather than floating somewhere near it, and why
 * dismissing it does not re-enable anything.
 *
 * It was a centred floating pill until 2026-08-31. Two problems with that: it
 * shared the `z-20` floating row with "Scroll to bottom" (they overlapped when
 * both showed), and it rendered the gateway's raw sentence — which names the
 * organisation by *id*, a 26-character opaque string the user has never seen.
 * The org NAME is right there in the auth snapshot.
 */

/**
 * The tucked strip, same construction as the artifacts composer's checkpoint
 * scope picker: inset by `mx-2` so the composer's box reads as the wider
 * element, `rounded-t-2xl` to match the agent composer's rounding, and
 * `-mb-3.5` against `pb-5` so the composer overlaps its lower half. `z-0`
 * keeps it behind — the composer carries `relative z-30`.
 */
const STRIP =
  "atlas-pill-in relative z-0 mx-2 -mb-3.5 flex items-center justify-between gap-3 " +
  "rounded-t-2xl bg-[var(--bg-tertiary)] px-3.5 pt-1.5 pb-5 text-[11px]";

const ACTION =
  "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors " +
  "text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] " +
  "disabled:cursor-default disabled:text-[var(--text-tertiary)]/40 disabled:hover:bg-transparent";

export function AiGrantBar() {
  const { t } = useTranslation();
  const snapshot = useAuthStore((s) => s.snapshot);
  // `AuthSnapshot` is a discriminated union — the orgs only exist on the
  // signed-in arm, which is also the only arm this bar renders under.
  const account = snapshot.status === "signed-in" ? snapshot : null;
  const activeOrgId = account?.activeOrgId ?? null;
  // The desktop's active org names the bar. The auth snapshot only knows the
  // account's CLOUD orgs, so it is the fallback, never the source — for a
  // local org it would name whichever cloud org the account last used.
  const org = useActiveOrganisation();
  const orgName = org?.name ?? account?.orgs?.find((o) => o.id === activeOrgId)?.name ?? null;
  const local = isLocalOrg(org);

  const entitlement = useAiGrantStore.use.entitlement();
  const checking = useAiGrantStore.use.checking();
  const requesting = useAiGrantStore.use.requesting();
  const requested = useAiGrantStore.use.requested();
  const dismissed = useAiGrantStore.use.dismissed();
  const { refresh, request, dismiss } = useAiGrantStore.use.actions();
  // The switcher's "Turn on sync for {org}…" item, offered here as well so the
  // one action that unlocks the agent is beside the notice that names it.
  const enableSync = useOrgStore((s) => s.actions.enableSync);
  const [syncing, setSyncing] = useState(false);
  const onTurnOnSync = useCallback(async () => {
    if (!org) return;
    // Signed out, `enableSync` opens sign-in and returns at once — no spinner
    // to show. Signed in it round-trips: hold the syncing state until it
    // settles (success → the bar goes away with the probe; failure → the
    // store's own toast).
    if (!account) {
      void enableSync(org.id);
      return;
    }
    setSyncing(true);
    try {
      await enableSync(org.id);
    } finally {
      setSyncing(false);
    }
  }, [account, enableSync, org]);

  const onRefresh = useCallback(async () => {
    // A failed re-check leaves the bar exactly as it was rather than clearing
    // it — vanishing on a dropped connection would read as "you have access now".
    if (!(await refresh())) toast.error(t("chat.aiGrantBar.couldNotReachGateway"));
  }, [refresh, t]);

  const onRequest = useCallback(async () => {
    try {
      await request();
    } catch (e) {
      toast.error(String(e));
    }
  }, [request]);

  if (dismissed) return null;

  // A local organisation: not a grant that is missing, a link that is. The
  // native agent bills an org the gateway knows, and this one only exists on
  // this machine — so the only action is turning on sync, which lives in the
  // org switcher, not here.
  if (entitlement?.state === "localOrg" && local) {
    return (
      <div
        data-testid="ai-grant-bar"
        className={STRIP}
        title={t("chat.aiGrantBar.localOrgBarTitle")}
      >
        <span className="min-w-0 truncate text-[var(--text-tertiary)]">
          <Trans
            i18nKey="chat.aiGrantBar.localOrgNotice"
            values={{ org: orgName ?? t("chat.aiGrantBar.thisOrganisation") }}
            components={{ bold: <span className="font-semibold text-[var(--text-primary)]" /> }}
          />
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void onTurnOnSync()}
            disabled={syncing}
            title={
              account ? t("chat.aiGrantBar.createOrgTitle") : t("chat.aiGrantBar.signInToSyncTitle")
            }
            className={cn(ACTION, syncing ? "cursor-default" : "cursor-pointer")}
          >
            <Cloud size={11} className={cn(syncing && "animate-pulse")} />
            {syncing ? t("chat.aiGrantBar.syncing") : t("chat.aiGrantBar.turnOnSync")}
          </button>
          <button
            type="button"
            onClick={() => dismiss()}
            title={t("chat.aiGrantBar.dismiss")}
            className="shrink-0 cursor-pointer rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (entitlement?.state !== "noGrant") return null;

  return (
    <div data-testid="ai-grant-bar" className={STRIP} title={entitlement.message}>
      <span className="min-w-0 truncate text-[var(--text-tertiary)]">
        <Trans
          i18nKey="chat.aiGrantBar.noGrantNotice"
          values={{ org: orgName ?? t("chat.aiGrantBar.thisOrganisation") }}
          components={{ bold: <span className="font-semibold text-[var(--text-primary)]" /> }}
        />
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={checking}
          title={t("chat.aiGrantBar.checkAgain")}
          className={cn(ACTION, checking ? "cursor-default" : "cursor-pointer")}
        >
          <RotateCw size={11} className={cn(checking && "animate-spin")} />
          {t("chat.aiGrantBar.refresh")}
        </button>

        <button
          type="button"
          onClick={() => void onRequest()}
          disabled={requesting || requested}
          title={
            requested
              ? t("chat.aiGrantBar.requestRecorded")
              : t("chat.aiGrantBar.requestAccessTitle")
          }
          className={cn(ACTION, requesting || requested ? "cursor-default" : "cursor-pointer")}
        >
          {requested ? <Check size={11} /> : null}
          {requested
            ? t("chat.aiGrantBar.requested")
            : requesting
              ? t("chat.aiGrantBar.requesting")
              : t("chat.aiGrantBar.request")}
        </button>

        <button
          type="button"
          onClick={() => dismiss()}
          title={t("chat.aiGrantBar.dismiss")}
          className="shrink-0 cursor-pointer rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

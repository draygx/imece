import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { useChatStore } from "../stores/chat-store";

/**
 * Live retry countdown (native agent): shown while a transient provider
 * failure (rate limit / overload / 5xx) is being retried after a backoff.
 * Driven by the `retry_status` delta; clears itself when content resumes
 * flowing or the turn ends (the store owns clearing — this only renders).
 */
export function RetryPill({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const retry = useChatStore((s) => s.sessions[tabId]?.retryStatus);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!retry) return;
    // 1s, not 250ms: the label renders whole seconds, so three of every four
    // ticks were re-rendering the pill to the identical string. And no tick
    // at all while hidden — `now` re-seeds on the visibility edge.
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    const intervalId = setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [retry]);

  if (!retry) return null;

  const remainingMs = Math.max(0, retry.receivedAt + retry.delayMs - now);
  const secs = Math.ceil(remainingMs / 1000);
  // Terse cause: first line of the provider error, without the JSON tail.
  const cause = retry.lastError.split("\n")[0].slice(0, 80);

  return (
    <div
      data-testid="retry-pill"
      className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-secondary)]"
      title={retry.lastError}
    >
      <RotateCw size={12} className="animate-spin text-[var(--text-tertiary)]" />
      <span className="font-medium text-[var(--text-primary)]">
        {secs > 0
          ? t("chat.retryPill.retryingWithTime", {
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
              secs,
            })
          : t("chat.retryPill.retryingNow", {
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
            })}
      </span>
      <span className="truncate text-[var(--text-tertiary)]">{cause}</span>
    </div>
  );
}

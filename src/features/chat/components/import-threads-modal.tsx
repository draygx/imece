import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importCandidates, importThreads, type ImportCandidate } from "../lib/history-api";

/**
 * Pull sessions an agent kept for itself into Atlas's history.
 *
 * The only route external history has into Atlas, and it goes through the
 * protocol: each installed agent is asked for its own session list
 * (ADR-0001). An agent that cannot answer is listed anyway, disabled, with the
 * capability it is missing named — a user who cannot find their agent has no
 * way to tell a missing feature from a missing agent.
 *
 * Composed from the same Dialog shell, tokens and type scale as the other
 * modals; no new visual pattern.
 */
export function ImportThreadsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Probing starts every installed agent, so it only runs while the modal is
  // actually open.
  useEffect(() => {
    if (!open) {
      setCandidates(null);
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    void importCandidates()
      .then((found) => {
        if (cancelled) return;
        setCandidates(found);
        // Pre-select everything with something to offer: the common case is
        // "yes, all of it".
        setSelected(
          new Set(
            found
              .filter((c) => c.status.kind === "ready" && c.status.importable > 0)
              .map((c) => c.pluginId),
          ),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCandidates([]);
        toast.error(t("chat.importThreads.couldNotCheck", { error: String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const toggle = useCallback((pluginId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(pluginId)) next.add(pluginId);
      return next;
    });
  }, []);

  const runImport = useCallback(async () => {
    setImporting(true);
    try {
      const count = await importThreads([...selected]);
      toast.success(
        count === 0
          ? t("chat.importThreads.nothingNewToImport")
          : t("chat.importThreads.importedCount", { count }),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(t("chat.importThreads.importFailed", { error: String(err) }));
    } finally {
      setImporting(false);
    }
  }, [selected, onOpenChange, t]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[80vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-md",
            "border border-border-default bg-bg-elevated shadow-[var(--shadow-overlay)] animate-scale-in",
          )}
        >
          <div className="flex items-center gap-3 border-b border-border-default px-4 py-2.5">
            <Dialog.Title className="text-[13px] font-semibold text-text-primary">
              {t("chat.importThreads.title")}
            </Dialog.Title>
            <Dialog.Close
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
              aria-label={t("chat.importThreads.closeAriaLabel")}
            >
              <X size={13} />
            </Dialog.Close>
          </div>

          <p className="px-4 pt-3 text-[11px] leading-relaxed text-text-tertiary">
            {t("chat.importThreads.description")}
          </p>

          <div className="flex-1 overflow-auto hide-scrollbar px-2 py-2">
            {candidates === null ? (
              <div className="px-2 py-6 text-center text-[11px] text-text-tertiary">
                {t("chat.importThreads.askingAgents")}
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11px] text-text-tertiary">
                {t("chat.importThreads.noAgentsInstalled")}
              </div>
            ) : (
              candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.pluginId}
                  candidate={candidate}
                  checked={selected.has(candidate.pluginId)}
                  onToggle={() => toggle(candidate.pluginId)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border-default px-4 py-2.5">
            <Dialog.Close className="rounded px-2.5 py-1 text-[11px] text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer">
              {t("chat.importThreads.cancel")}
            </Dialog.Close>
            <button
              type="button"
              disabled={importing || selected.size === 0}
              onClick={() => void runImport()}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                "bg-accent text-text-inverse hover:bg-accent-hover",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {importing
                ? t("chat.importThreads.importingLabel")
                : t("chat.importThreads.importLabel")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ImportCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const selectable = candidate.status.kind === "ready" && candidate.status.importable > 0;
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={!selectable}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 w-full rounded px-2 py-1.5 text-left transition-colors",
        !selectable && "cursor-not-allowed opacity-60",
        selectable && (checked ? "bg-bg-selected" : "cursor-pointer hover:bg-bg-hover"),
      )}
    >
      <span className="flex-1 min-w-0 truncate text-[11px] text-text-primary">
        {candidate.displayName}
      </span>
      <CandidateStatus status={candidate.status} />
      {checked && <Check size={12} className="text-text-secondary shrink-0" />}
    </button>
  );
}

function CandidateStatus({ status }: { status: ImportCandidate["status"] }) {
  const { t } = useTranslation();
  if (status.kind === "ready") {
    return (
      <span className="shrink-0 text-[10px] font-mono tabular-nums text-text-tertiary">
        {status.importable === 0
          ? t("chat.importThreads.nothingNewStatus")
          : t("chat.importThreads.sessionCountStatus", { count: status.importable })}
      </span>
    );
  }
  // Named and *visible*: a `title` on a disabled control shows no tooltip, so
  // the one thing the user needs — which capability their agent is missing —
  // would never appear.
  const reason =
    status.kind === "unsupported" ? t("chat.importThreads.noSessionListSupport") : status.message;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-[10px] text-text-tertiary">
      <AlertTriangle size={10} className="shrink-0" />
      <span className="truncate" title={reason}>
        {reason}
      </span>
    </span>
  );
}

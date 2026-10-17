import { useMemo, useState, useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Check, Search, Loader2, GitMerge, AlertTriangle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGitStore, type MergePreview } from "../../stores/git-store";
import { handleGitError } from "../../lib/git-errors";

/**
 * GitHub-Desktop-style "Choose a branch to merge into <current>" dialog.
 * Pick a branch, see a live pre-merge preview (commits brought in / conflict
 * count / up-to-date / unrelated histories), then merge. The actual merge
 * reuses the existing `mergeBranch` action (`git merge --no-edit`).
 */
export function MergeBranchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const branch = useGitStore.use.branch();
  const branchesFull = useGitStore.use.branchesFull();
  const actions = useGitStore.use.actions();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [merging, setMerging] = useState(false);
  // Fetch-on-open: without it every preview compares against WHATEVER the last
  // fetch left in refs/remotes — unfetched remote commits are invisible to
  // git, so "merge main" against a stale origin said "already up to date"
  // while the remote had moved on. GitHub Desktop hides this with a periodic
  // background fetcher; Atlas fetches when the dialog opens instead. The
  // `fetchNonce` bump re-runs the live preview once fresh refs land.
  const [fetching, setFetching] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);

  // Everything except the branch we're merging *into*.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branchesFull.filter((b) => !b.isCurrent && (!q || b.name.toLowerCase().includes(q)));
  }, [branchesFull, query]);

  // Reset all transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(null);
      setPreview(null);
      setPreviewing(false);
      setFetching(false);
    }
  }, [open]);

  // Refresh remote refs the moment the dialog opens (non-blocking — the list
  // and preview stay usable; they just re-verify once the fetch lands).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFetching(true);
    actions
      .fetch()
      .catch(() => {
        // Offline / no remote — previews still work against local refs.
      })
      .finally(() => {
        if (cancelled) return;
        setFetching(false);
        setFetchNonce((n) => n + 1);
        // Rebuild branchesFull so ahead/behind + remote tips reflect the fetch.
        void actions.refreshStatusNow();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recompute the preview whenever the chosen branch changes.
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreview(null);
    actions
      .mergePreview(selected)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, actions, fetchNonce]);

  // The GitHub-Desktop insight the old dialog missed: picking a stale LOCAL
  // branch (e.g. `main` while `origin/main` is ahead) previews "up to date"
  // even though the remote has new work. `behind` on a local BranchInfo is
  // exactly "commits its upstream has that it lacks" — surface it and offer
  // the upstream ref instead.
  const selectedInfo = useMemo(
    () => branchesFull.find((b) => b.name === selected) ?? null,
    [branchesFull, selected],
  );
  const staleUpstream =
    selectedInfo && !selectedInfo.isRemote && selectedInfo.upstream && selectedInfo.behind > 0
      ? { upstream: selectedInfo.upstream, behind: selectedInfo.behind }
      : null;

  const canMerge =
    !!selected &&
    !merging &&
    !previewing &&
    preview != null &&
    preview.kind !== "uptodate" &&
    preview.kind !== "invalid";

  const doRebase = async () => {
    if (!selected) return;
    setMerging(true);
    try {
      await actions.rebase(selected);
      toast.success(t("git.mergeBranchDialog.rebasedToast", { branch, selected }));
      onOpenChange(false);
    } catch (e) {
      // Conflicts pause the rebase — the in-progress banner + conflicts
      // view take over; other failures get the typed treatment.
      handleGitError(e);
      onOpenChange(false);
    } finally {
      void actions.refreshStatusNow();
      void actions.loadInProgress();
      setMerging(false);
    }
  };

  const doMerge = async () => {
    if (!selected) return;
    setMerging(true);
    const wasConflicts = preview?.kind === "conflicts";
    try {
      await actions.mergeBranch(selected);
      toast.success(t("git.mergeBranchDialog.mergedToast", { selected, branch }));
      onOpenChange(false);
    } catch (e) {
      // `git merge` exits non-zero on conflicts (the merge is still started —
      // MERGE_HEAD is set), so an error here usually means "conflicts to
      // resolve" rather than an outright failure.
      if (wasConflicts) {
        toast.warning(t("git.mergeBranchDialog.mergedWithConflictsToast", { selected }));
      } else {
        handleGitError(e);
      }
      onOpenChange(false);
    } finally {
      // `git_merge_branch` skips its change-event when git exits non-zero, so
      // force a refresh — this surfaces the in-progress/conflict banner.
      void actions.refreshStatusNow();
      void actions.loadInProgress();
      setMerging(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[var(--z-overlay)]" />
        <Dialog.Content
          className="fixed left-1/2 top-[22%] -translate-x-1/2 z-[var(--z-modal)] w-[420px] rounded-xl overflow-hidden bg-[var(--bg-elevated)] border border-border-default shadow-[var(--shadow-overlay)] flex flex-col"
          onOpenAutoFocus={(e) => {
            // Keep focus on the filter input (rendered below), not the list.
            e.preventDefault();
          }}
        >
          <div className="px-4 pt-3.5 pb-3 border-b border-border-default">
            <Dialog.Title className="text-[13px] font-semibold text-text-primary flex items-center gap-1.5">
              <GitMerge size={13} className="text-text-secondary shrink-0" />
              <span>
                <Trans
                  i18nKey="git.mergeBranchDialog.mergeIntoTitle"
                  values={{ branch: branch || "—" }}
                  components={{ code: <span className="font-mono text-accent" /> }}
                />
              </span>
            </Dialog.Title>
            <Dialog.Description className="text-[11px] text-text-tertiary mt-1">
              <Trans
                i18nKey="git.mergeBranchDialog.chooseBranchDescription"
                values={{ branch: branch || t("git.manager.currentBranchFallback") }}
                components={{ code: <span className="font-mono" /> }}
              />
            </Dialog.Description>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1.5 px-3 h-[32px] border-b border-border-default shrink-0">
            <Search size={11} className="text-text-tertiary shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("git.branchSwitcher.filterPlaceholder")}
              autoFocus
              className="flex-1 bg-transparent outline-none text-[11px] text-text-primary placeholder:text-text-tertiary min-w-0"
            />
          </div>

          {/* Branch list */}
          <div className="max-h-[260px] overflow-y-auto hide-scrollbar py-1">
            {filtered.map((b) => {
              const isSel = b.name === selected;
              return (
                <div
                  key={b.name}
                  role="option"
                  aria-selected={isSel}
                  onClick={() => setSelected(b.name)}
                  className={cn(
                    "group flex items-center gap-2 px-3 h-[28px] text-[11px] cursor-pointer",
                    isSel
                      ? "bg-bg-selected text-text-primary"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                  )}
                >
                  <Check
                    size={12}
                    className={cn("shrink-0", isSel ? "text-accent" : "opacity-0")}
                  />
                  <span className="truncate flex-1 font-mono">{b.name}</span>
                  {b.isRemote && (
                    <span className="shrink-0 text-[8px] font-mono uppercase tracking-wide text-text-tertiary border border-border-default rounded px-1">
                      {t("git.branchSwitcher.remoteBadge")}
                    </span>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-[10px] text-text-tertiary text-center">
                {t("git.mergeBranchDialog.noOtherBranches")}
              </div>
            )}
          </div>

          {/* Preview + actions */}
          <div className="border-t border-border-default px-3 py-2.5 flex flex-col gap-2.5">
            {fetching && (
              <p className="text-[10px] text-text-tertiary flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin shrink-0" />
                {t("git.mergeBranchDialog.checkingOrigin")}
              </p>
            )}
            {staleUpstream && (
              <p className="text-[11px] text-[var(--status-warning)] flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>
                  <Trans
                    i18nKey="git.mergeBranchDialog.staleUpstreamWarning"
                    values={{
                      selected,
                      upstream: staleUpstream.upstream,
                      count: staleUpstream.behind,
                    }}
                    components={{
                      branch: <span className="font-mono" />,
                      upstreamBranch: <span className="font-mono" />,
                      mergeInsteadBtn: (
                        <button
                          onClick={() => setSelected(staleUpstream.upstream)}
                          className="underline underline-offset-2 hover:text-text-primary cursor-pointer"
                        />
                      ),
                    }}
                  />
                </span>
              </p>
            )}
            <MergePreviewLine
              selected={selected}
              current={branch}
              previewing={previewing}
              preview={preview}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => onOpenChange(false)}
                className="px-3 h-7 rounded text-[11px] text-text-secondary hover:bg-bg-hover transition-colors"
              >
                {t("git.mergeBranchDialog.cancel")}
              </button>
              <button
                onClick={() => void doRebase()}
                disabled={!canMerge}
                title={
                  selected
                    ? t("git.mergeBranchDialog.rebaseTitleWithBranches", { branch, selected })
                    : t("git.mergeBranchDialog.rebaseButton")
                }
                className={cn(
                  "px-3 h-7 rounded text-[11px] font-medium transition-colors",
                  canMerge
                    ? "text-text-primary border border-border-default hover:bg-bg-hover"
                    : "text-text-tertiary bg-bg-hover cursor-not-allowed",
                )}
              >
                {t("git.mergeBranchDialog.rebaseButton")}
              </button>
              <button
                onClick={() => void doMerge()}
                disabled={!canMerge}
                // `text-text-inverse` on the accent fill, never `text-white` —
                // see the note in `git-error-dialog`.
                className={cn(
                  "flex items-center gap-1.5 px-3 h-7 rounded text-[11px] font-medium transition-colors",
                  canMerge
                    ? "text-text-inverse bg-accent hover:opacity-90"
                    : "text-text-tertiary bg-bg-hover cursor-not-allowed",
                )}
              >
                {merging ? <Loader2 size={11} className="animate-spin" /> : <GitMerge size={11} />}
                {selected
                  ? t("git.mergeBranchDialog.mergeButtonWithBranch", { branch: selected })
                  : t("git.mergeBranchDialog.mergeButton")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MergePreviewLine({
  selected,
  current,
  previewing,
  preview,
}: {
  selected: string | null;
  current: string;
  previewing: boolean;
  preview: MergePreview | null;
}) {
  const { t } = useTranslation();
  if (!selected) {
    return (
      <p className="text-[11px] text-text-tertiary">
        {t("git.mergeBranchDialog.selectBranchHint")}
      </p>
    );
  }
  if (previewing || !preview) {
    return (
      <p className="text-[11px] text-text-tertiary flex items-center gap-1.5">
        <Loader2 size={11} className="animate-spin shrink-0" />
        {t("git.mergeBranchDialog.checkingAbility")}
      </p>
    );
  }

  const branchSpan = { className: "font-mono" };
  const n = preview.commitCount;

  switch (preview.kind) {
    case "uptodate":
      return (
        <p className="text-[11px] text-text-tertiary">
          <Trans
            i18nKey="git.mergeBranchDialog.uptodateMsg"
            values={{ dst: current, src: selected }}
            components={{ dst: <span {...branchSpan} />, src: <span {...branchSpan} /> }}
          />
        </p>
      );
    case "invalid":
      return (
        <p className="text-[11px] text-[var(--status-error)] flex items-center gap-1.5">
          <Ban size={11} className="shrink-0" />
          {t("git.mergeBranchDialog.invalidMsg")}
        </p>
      );
    case "conflicts":
      return (
        <p className="text-[11px] text-[var(--status-warning)] flex items-center gap-1.5">
          <AlertTriangle size={11} className="shrink-0" />
          <span>
            <Trans
              i18nKey="git.mergeBranchDialog.conflictsMsg"
              values={{ count: preview.conflictedFiles, src: selected, dst: current }}
              components={{ dst: <span {...branchSpan} />, src: <span {...branchSpan} /> }}
            />
          </span>
        </p>
      );
    case "unsupported":
    case "clean":
    default:
      return (
        <p className="text-[11px] text-text-secondary">
          <Trans
            i18nKey="git.mergeBranchDialog.cleanMsg"
            values={{ count: n, src: selected, dst: current }}
            components={{ dst: <span {...branchSpan} />, src: <span {...branchSpan} /> }}
          />
        </p>
      );
  }
}

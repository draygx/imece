import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Search,
  Check,
  Minus,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Trash2,
  MoreHorizontal,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { SecretInput } from "@/ui/secret-input";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { tildePath } from "@/lib/paths";
import { AtlasLoader } from "@/components/atlas-loader";
import { ProviderLogo } from "@/components/provider-logo";
import {
  PROVIDERS,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  type ProviderDef,
} from "../lib/providers";
import { useByokStore } from "../stores/byok-store";
import { byok, type EnvEntry } from "../lib/byok-api";

/**
 * API keys — an editor for the provider keys in the user's shell profile.
 *
 * Atlas stores nothing. Every row here is an `export VAR=...` line in a real
 * file, and editing one rewrites that line. A key set somewhere Atlas can see
 * but not edit (launchd, `/etc/profile`, a wrapper script) is shown read-only
 * rather than duplicated — there is deliberately no Atlas-owned copy that could
 * drift from the environment the user's other tools read.
 */

type SortKey = "name" | "category" | "configured";

// Column widths shared by the header + every row so cells line up. Fixed
// widths (Provider grows) inside a min-width track so columns never collapse
// or overlap — the table scrolls horizontally when the panel is narrow.
const COL = {
  provider: "flex-1 min-w-[200px]",
  env: "w-[200px] shrink-0",
  category: "w-[120px] shrink-0",
  key: "w-[100px] shrink-0",
  source: "w-[200px] shrink-0",
  chevron: "w-[32px] shrink-0",
} as const;

const TABLE_MIN_W = 200 + 200 + 120 + 100 + 200 + 32; // 852

export function ProvidersSettings() {
  const { t } = useTranslation();
  const SORT_LABELS: Record<SortKey, string> = {
    name: t("providers.sort.nameAz"),
    category: t("providers.sort.category"),
    configured: t("providers.sort.setFirst"),
  };
  const entries = useByokStore.use.entries();
  const profile = useByokStore.use.profile();
  const loaded = useByokStore.use.loaded();
  const { load } = useByokStore.use.actions();

  const [category, setCategory] = useState<ProviderCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  /** provider id → the entry Atlas resolved for it (any recognised spelling). */
  const byProvider = useMemo(() => {
    const m: Record<string, EnvEntry> = {};
    for (const e of entries) if (!m[e.provider]) m[e.provider] = e;
    return m;
  }, [entries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = PROVIDERS.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (configuredOnly && !byProvider[p.id]) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.id.includes(q) &&
        !p.env.toLowerCase().includes(q)
      )
        return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortKey === "configured") {
        const ca = byProvider[a.id] ? 0 : 1;
        const cb = byProvider[b.id] ? 0 : 1;
        if (ca !== cb) return ca - cb;
      } else if (sortKey === "category" && a.category !== b.category) {
        return PROVIDER_CATEGORIES.indexOf(a.category) - PROVIDER_CATEGORIES.indexOf(b.category);
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [category, query, sortKey, configuredOnly, byProvider]);

  const tabs: Array<{ id: ProviderCategory | "All"; label: string; count: number }> = useMemo(
    () => [
      { id: "All", label: t("providers.allCategory"), count: PROVIDERS.length },
      ...PROVIDER_CATEGORIES.map((c) => ({
        id: c,
        label: c,
        count: PROVIDERS.filter((p) => p.category === c).length,
      })),
    ],
    [t],
  );

  return (
    <div className="h-full flex flex-col bg-bg-base">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-[40px] shrink-0 border-b border-border-default">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setCategory(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-[40px] text-[11px] font-medium transition-colors border-b-2 -mb-px",
              category === t.id
                ? "text-text-primary border-b-[var(--accent-primary)]"
                : "text-text-secondary hover:text-text-primary border-b-transparent",
            )}
          >
            {t.label}
            <span className="text-[9px] text-text-tertiary tabular-nums">{t.count}</span>
          </button>
        ))}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 h-6 rounded-md border border-border-default bg-bg-elevated px-2 min-w-[200px] focus-within:border-[var(--border-focus)]">
          <Search size={11} className="text-text-tertiary shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("providers.searchPlaceholder")}
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-text-primary placeholder:text-text-tertiary"
          />
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex items-center justify-center w-6 h-6 shrink-0 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover cursor-pointer outline-none transition-colors"
              title={t("providers.filtersAndSort")}
              aria-label={t("providers.filtersAndSort")}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-overlay)] py-1 min-w-[180px]"
              style={{ zIndex: 9999 }}
            >
              <DropdownMenu.CheckboxItem
                checked={configuredOnly}
                onCheckedChange={(c) => setConfiguredOnly(!!c)}
                className="flex items-center gap-2 px-3 h-[26px] text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer outline-none"
              >
                <span className="inline-flex w-3.5 justify-center">
                  {configuredOnly && <Check size={11} className="text-text-primary" />}
                </span>
                {t("providers.setOnly")}
              </DropdownMenu.CheckboxItem>

              <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

              <DropdownMenu.Label className="px-3 pb-1 pt-1 text-[9px] uppercase tracking-wider text-text-tertiary">
                {t("providers.sortBy")}
              </DropdownMenu.Label>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <DropdownMenu.Item
                  key={k}
                  onSelect={() => setSortKey(k)}
                  className="flex items-center justify-between gap-2 px-3 h-[26px] text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer outline-none"
                >
                  {SORT_LABELS[k]}
                  {sortKey === k && <Check size={11} className="text-text-primary" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="flex-1 min-h-0 overflow-auto hide-scrollbar">
        <div style={{ minWidth: TABLE_MIN_W }}>
          <div className="sticky top-0 z-10 flex items-center h-[28px] border-b border-border-default bg-bg-base px-3 text-[10px] uppercase tracking-wider text-text-tertiary">
            <span className={COL.provider}>{t("providers.table.provider")}</span>
            <span className={COL.env}>{t("providers.table.envVar")}</span>
            <span className={COL.category}>{t("providers.table.category")}</span>
            <span className={COL.key}>{t("providers.table.key")}</span>
            <span className={COL.source}>{t("providers.table.source")}</span>
            <span className={COL.chevron} />
          </div>

          {rows.length === 0 ? (
            <div className="grid place-items-center h-[160px] text-[11px] text-text-tertiary">
              {t("providers.noMatches")}
            </div>
          ) : (
            rows.map((p) => (
              <ProviderTableRow
                key={p.id}
                provider={p}
                entry={byProvider[p.id]}
                targetFile={profile?.target ?? null}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderTableRow({
  provider,
  entry,
  targetFile,
  expanded,
  onToggle,
}: {
  provider: ProviderDef;
  entry: EnvEntry | undefined;
  targetFile: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center h-[40px] px-3 text-left transition-colors",
          expanded ? "bg-[var(--bg-elevated)]/40" : "hover:bg-bg-hover",
        )}
      >
        <span className={cn(COL.provider, "flex items-center gap-2 min-w-0")}>
          <ProviderLogo id={provider.id} size={18} />
          <span className="truncate text-[12px] text-text-primary">{provider.name}</span>
        </span>
        {/* The var it was actually found as — which may be an alias spelling. */}
        <span className={cn(COL.env, "truncate font-mono text-[10px] text-text-tertiary")}>
          {entry?.envVar ?? provider.env}
        </span>
        <span className={cn(COL.category, "truncate text-[11px] text-text-secondary")}>
          {provider.category}
        </span>
        <span className={cn(COL.key, "font-mono text-[11px]")}>
          {entry ? (
            <span className="text-text-secondary">••••{entry.last4}</span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </span>
        <span className={cn(COL.source, "flex items-center gap-1.5 min-w-0")}>
          {!entry ? (
            <>
              <Minus size={12} className="text-text-tertiary shrink-0" />
              <span className="text-[11px] text-text-tertiary">{t("providers.notSet")}</span>
            </>
          ) : entry.editable ? (
            <span
              className="truncate font-mono text-[10px] text-text-secondary"
              title={`${entry.file}${entry.line ? `:${entry.line}` : ""}`}
            >
              {tildePath(entry.file!)}
              {entry.line ? `:${entry.line}` : ""}
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[10px] font-medium text-text-tertiary border border-border-default rounded-full px-1.5 h-[18px]"
              title={t("providers.environmentBadgeTitle")}
            >
              <Lock size={9} />
              {t("providers.environmentBadge")}
            </span>
          )}
        </span>
        <span className={cn(COL.chevron, "flex items-center justify-end text-text-tertiary")}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded && <ProviderEditor provider={provider} entry={entry} targetFile={targetFile} />}
    </div>
  );
}

function ProviderEditor({
  provider,
  entry,
  targetFile,
}: {
  provider: ProviderDef;
  entry: EnvEntry | undefined;
  targetFile: string | null;
}) {
  const { t } = useTranslation();
  const pending = useByokStore.use.pending();
  const { save, remove } = useByokStore.use.actions();
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  // The var an edit writes: whatever it was found as, else the canonical one.
  const envVar = entry?.envVar ?? provider.env;
  const busy = pending === envVar;
  const readOnly = !!entry && !entry.editable;
  const writesTo = entry?.file ?? targetFile;

  const onSave = async () => {
    try {
      const file = await save(envVar, draft);
      setDraft("");
      setRevealed(null);
      toast.success(
        t("providers.toasts.keyWritten", { provider: provider.name, file: tildePath(file) }),
        {
          action: {
            label: t("providers.toasts.revealAction"),
            onClick: () => {
              revealItemInDir(file).catch((err) => {
                toast.error(
                  t("providers.toasts.revealFailed", {
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              });
            },
          },
        },
      );
    } catch (e) {
      toast.error(
        t("providers.toasts.saveFailed", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const onRemove = async () => {
    try {
      await remove(envVar);
      setRevealed(null);
      toast.success(t("providers.toasts.removed", { envVar }));
    } catch (e) {
      toast.error(
        t("providers.toasts.removeFailed", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const onReveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    try {
      setRevealed((await byok.reveal(envVar)) ?? "");
    } catch {
      toast.error(t("providers.toasts.readFailed"));
    }
  };

  return (
    <div className="bg-[var(--bg-elevated)]/40 border-t border-border-subtle px-3 py-3">
      {readOnly && (
        <p className="mb-2.5 max-w-[640px] text-[10.5px] leading-snug text-text-tertiary">
          <Trans
            i18nKey="providers.readOnlyNotice"
            values={{ envVar }}
            components={{ code: <span className="font-mono" /> }}
          />
        </p>
      )}

      {entry && (
        <div className="mb-2.5 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate rounded bg-[var(--bg-base)] border border-border-subtle px-2 py-1 font-mono text-[10.5px] text-text-secondary">
            {revealed !== null ? revealed || "(empty)" : `${envVar}=••••${entry.last4}`}
          </code>
          <button
            type="button"
            onClick={() => void onReveal()}
            title={revealed !== null ? t("providers.hide") : t("providers.reveal")}
            className="flex items-center justify-center h-6 w-6 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {revealed !== null ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          {revealed !== null && revealed && (
            <button
              type="button"
              onClick={() => void copyText(revealed)}
              className="h-6 rounded-md px-2 text-[10.5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              {t("providers.copy")}
            </button>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex items-start gap-3 max-w-[640px]">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-text-primary">
                {entry ? t("providers.replaceKey") : t("providers.apiKey")}
              </label>
              {provider.docsUrl && (
                <button
                  type="button"
                  onClick={() => void openUrl(provider.docsUrl!)}
                  className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary transition-colors"
                >
                  {t("providers.getKey")}
                  <ExternalLink size={10} />
                </button>
              )}
            </div>
            <SecretInput
              value={draft}
              onValueChange={setDraft}
              onSubmit={() => void onSave()}
              placeholder={provider.placeholder ?? t("providers.pasteApiKey")}
              disabled={busy}
              autoFocus
            />
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={busy || !draft.trim()}
                className={cn(
                  "flex items-center gap-1.5 h-7 rounded-md px-3 text-[11px] font-medium",
                  "bg-[var(--accent-primary)] text-[var(--bg-base)]",
                  "hover:opacity-90 transition-opacity",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                {busy && <AtlasLoader size={11} />}
                {entry ? t("providers.update") : t("providers.save")}
              </button>
              {entry && (
                <button
                  type="button"
                  onClick={() => void onRemove()}
                  disabled={busy}
                  className="flex items-center gap-1 h-7 rounded-md px-2.5 text-[11px] text-text-tertiary hover:text-[var(--danger,#e5484d)] hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  {t("providers.remove")}
                </button>
              )}
            </div>
            <p className="pt-0.5 font-mono text-[10px] text-text-tertiary">
              {entry ? t("providers.rewrites") : t("providers.appends")}{" "}
              <span className="text-text-secondary">export {envVar}=…</span>
              {writesTo ? t("providers.inFile", { file: tildePath(writesTo) }) : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

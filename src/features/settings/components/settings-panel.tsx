import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Settings,
  Palette,
  Keyboard,
  Info,
  KeyRound,
  LayoutTemplate,
  Zap,
  WandSparkles,
  Boxes,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  DownloadCloud,
} from "lucide-react";
import { clampScale, SCALE_STEP, MIN_SCALE, MAX_SCALE, DEFAULT_SCALE } from "../lib/ui-scale";
import { AtlasIcon } from "@/components/atlas-icon";
import { ProvidersSettings } from "./providers-settings";
import { LayoutsSettings } from "./layouts-settings";
import { CodeEditorThemesSettings } from "./code-editor-themes-settings";
import { AtlasThemesSettings } from "./atlas-themes-settings";
import { SkillsAndPacks } from "./skills-and-packs";
import { AgentsMarketplace } from "./agents-marketplace/agents-marketplace";
import { ModelsManager } from "./models-manager";
import { KeybindingsSettings } from "./keybindings-settings";
import { useActionShortcut } from "@/features/keybindings/lib/use-action-shortcut";
import { useModelPricingStore } from "../stores/model-pricing-store";
import { useProjectStore } from "@/features/project/stores/project-store";
const setTelemetryEnabled = (_enabled: boolean) => {}; // no-op stub
import { useFeedbackStore } from "@/features/feedback/stores/feedback-store";
import { updater } from "@/features/updater/lib/updater-api";
import { useUpdaterStore } from "@/features/updater/stores/updater-store";
import { useSettingsNav, type SettingsSection } from "../stores/settings-nav-store";
import { openConfigFile } from "../lib/atlas-config-api";

const SECTIONS: Array<{
  id: SettingsSection;
  icon: typeof Settings;
}> = [
  { id: "general", icon: Settings },
  { id: "appearance", icon: Palette },
  { id: "layouts", icon: LayoutTemplate },
  { id: "providers", icon: KeyRound },
  { id: "skills", icon: Zap },
  { id: "agents", icon: WandSparkles },
  { id: "models", icon: Boxes },
  { id: "updates", icon: DownloadCloud },
  { id: "keybindings", icon: Keyboard },
  { id: "about", icon: Info },
];

const NAV_COLLAPSED_KEY = "atlas:settings:navCollapsed";

export function SettingsPanel({ initialSection }: { initialSection?: string } = {}) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState(initialSection ?? "general");

  // Honor cross-component "open Settings → <section>" requests (e.g. the
  // sidebar's Skills button), whether this panel is fresh or already mounted.
  const navSection = useSettingsNav((s) => s.section);
  const clearNav = useSettingsNav((s) => s.clear);
  useEffect(() => {
    if (navSection) {
      setActiveSection(navSection);
      clearNav();
    }
  }, [navSection, clearNav]);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleNav = () =>
    setNavCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <div className="h-full flex">
      {/* Settings nav — collapses to an icon rail (labels become tooltips). */}
      <div
        className={cn(
          "shrink-0 border-r border-border-default bg-bg-primary pt-2 flex flex-col",
          navCollapsed ? "w-[44px]" : "w-[180px]",
        )}
      >
        <div className="flex-1">
          {SECTIONS.map((s) => {
            const label = t(`settings.nav.sections.${s.id}`);
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                title={navCollapsed ? label : undefined}
                className={cn(
                  "w-full flex items-center h-[32px] whitespace-nowrap text-[11px] font-medium transition-colors border-l-2 cursor-pointer",
                  navCollapsed ? "justify-center px-0" : "gap-2 px-4",
                  activeSection === s.id
                    ? "text-text-primary bg-bg-selected border-l-accent"
                    : "text-text-secondary hover:bg-bg-hover border-l-transparent",
                )}
              >
                <s.icon size={13} className="shrink-0" />
                {!navCollapsed && label}
              </button>
            );
          })}
        </div>

        {/* Hide / show toggle — divided from the section list. */}
        <button
          onClick={toggleNav}
          title={navCollapsed ? t("settings.nav.showSidebar") : t("settings.nav.hideSidebar")}
          className={cn(
            "mt-1 flex items-center h-[30px] whitespace-nowrap border-t border-border-default text-[11px] font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer",
            navCollapsed ? "justify-center px-0" : "gap-2 px-4",
          )}
        >
          {navCollapsed ? (
            <ChevronRight size={14} className="shrink-0" />
          ) : (
            <>
              <ChevronLeft size={14} className="shrink-0" />
              <span>{t("settings.nav.hide")}</span>
            </>
          )}
        </button>
      </div>

      {/* Settings content. The providers ("API Keys") and skills sections are
          full-bleed — each owns its own toolbar + scrolling layout and fills
          the area edge to edge, so they render outside the padded/max-width
          wrapper. (Skills uses a list + right-hand detail pane that needs the
          room.) */}
      {activeSection === "providers" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <ProvidersSettings />
        </div>
      ) : activeSection === "skills" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <SkillsAndPacks />
        </div>
      ) : activeSection === "agents" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <AgentsMarketplace />
        </div>
      ) : activeSection === "models" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <ModelsManager />
        </div>
      ) : activeSection === "appearance" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <AppearanceSettings />
        </div>
      ) : activeSection === "keybindings" ? (
        <div className="flex-1 min-w-0 min-h-0">
          <KeybindingsSettings />
        </div>
      ) : (
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-[500px]">
            {activeSection === "general" && <GeneralSettings />}
            {activeSection === "layouts" && <LayoutsSettings />}
            {activeSection === "updates" && <UpdatesSettings />}
            {activeSection === "about" && <AboutSettings />}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

interface CliStatus {
  installed: boolean;
  path: string | null;
  installedVersion: string | null;
  currentVersion: string;
}

function GeneralSettings() {
  const { t } = useTranslation();
  const settings = useProjectStore.use.settings();
  const configError = useProjectStore.use.configError();
  const { updateSettings, clearConfigError, resetConfig } = useProjectStore.use.actions();
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [resettingConfig, setResettingConfig] = useState(false);

  const recreateConfigDefaults = async () => {
    setResettingConfig(true);
    try {
      // The store action owns both the state write and the resulting side
      // effects (theme, zoom). Doing it here with `setState` raced the
      // `atlas:config-changed` listener and skipped those side effects
      // whenever this path won.
      await resetConfig();
      toast.success(t("settings.configError.resetSuccess"));
    } catch (e) {
      toast.error(
        t("settings.configError.resetFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setResettingConfig(false);
    }
  };

  // Model pricing (models.dev) — manual refresh + count for the picker.
  const pricingPrices = useModelPricingStore.use.prices();
  const pricingLoading = useModelPricingStore.use.loading();
  const { load: loadPricing, refresh: refreshPricing } = useModelPricingStore.use.actions();
  useEffect(() => {
    void loadPricing();
  }, [loadPricing]);
  const pricedModelCount = Object.keys(pricingPrices).filter((k) => k.includes("/")).length;
  const updatePricing = async () => {
    await refreshPricing();
    const n = Object.keys(useModelPricingStore.getState().prices).filter((k) =>
      k.includes("/"),
    ).length;
    toast.success(t("settings.behaviour.modelPricing.updateSuccess", { count: n }));
  };

  useEffect(() => {
    let cancelled = false;
    void invoke<CliStatus>("cli_status")
      .then((s) => {
        if (!cancelled) setCli(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const installCli = async () => {
    setInstalling(true);
    try {
      const next = await invoke<CliStatus>("cli_install_helper");
      setCli(next);
      toast.success(t("settings.behaviour.cli.installSuccess"));
    } catch (e) {
      toast.error(
        t("settings.behaviour.cli.installFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setInstalling(false);
    }
  };

  const cliInstalledLine = cli?.installed
    ? cli.installedVersion === cli.currentVersion
      ? t("settings.behaviour.cli.installedAt", { path: cli.path })
      : cli.installedVersion
        ? t("settings.behaviour.cli.installedAtWithVersion", {
            path: cli.path,
            installedVersion: cli.installedVersion,
            currentVersion: cli.currentVersion,
          })
        : t("settings.behaviour.cli.installedAtVersionUnknown", {
            path: cli.path,
            currentVersion: cli.currentVersion,
          })
    : t("settings.behaviour.cli.willInstallTo", { path: cli?.path ?? "~/.local/bin/atlas" });

  return (
    <div className="space-y-6">
      <SectionTitle
        title={t("settings.general.sectionTitle")}
        subtitle={t("settings.general.sectionSubtitle")}
      />
      <LanguageSetting />
      {configError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
          <p className="text-[12px] font-medium text-text-primary">
            {t("settings.configError.title")}
          </p>
          <p className="text-[11px] text-text-secondary font-mono break-all">{configError}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void openConfigFile()}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
                "text-text-primary hover:bg-bg-hover transition-colors",
              )}
            >
              {t("settings.configError.openConfig")}
            </button>
            <button
              type="button"
              onClick={() => void recreateConfigDefaults()}
              disabled={resettingConfig}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
                "text-text-primary hover:bg-bg-hover transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {resettingConfig
                ? t("settings.configError.resetting")
                : t("settings.configError.recreateDefaults")}
            </button>
            <button
              type="button"
              onClick={clearConfigError}
              className="h-7 rounded-md px-2.5 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              {t("settings.configError.dismiss")}
            </button>
          </div>
        </div>
      )}
      <SettingRow
        label={t("settings.enterToSend.label")}
        description={t("settings.enterToSend.description")}
      >
        <Toggle
          checked={settings.enterToSend}
          onChange={(next) => updateSettings({ enterToSend: next })}
        />
      </SettingRow>
      <SectionTitle
        title={t("settings.terminalNotifications.sectionTitle")}
        subtitle={t("settings.terminalNotifications.sectionSubtitle")}
      />
      <SettingRow
        label={t("settings.terminalNotifications.label")}
        description={t("settings.terminalNotifications.description")}
      >
        <Toggle
          checked={settings.terminalNotifications}
          onChange={(next) => updateSettings({ terminalNotifications: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.terminalNotifications.notifySuccessAfter.label")}
        description={t("settings.terminalNotifications.notifySuccessAfter.description")}
      >
        <select
          value={String(settings.terminalNotifyMinDurationMs)}
          disabled={!settings.terminalNotifications}
          onChange={(e) => updateSettings({ terminalNotifyMinDurationMs: Number(e.target.value) })}
          className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] outline-none disabled:opacity-40"
        >
          <option value="5000">
            {t("settings.terminalNotifications.notifySuccessAfter.options.5s")}
          </option>
          <option value="10000">
            {t("settings.terminalNotifications.notifySuccessAfter.options.10s")}
          </option>
          <option value="30000">
            {t("settings.terminalNotifications.notifySuccessAfter.options.30s")}
          </option>
          <option value="60000">
            {t("settings.terminalNotifications.notifySuccessAfter.options.1m")}
          </option>
          <option value="300000">
            {t("settings.terminalNotifications.notifySuccessAfter.options.5m")}
          </option>
        </select>
      </SettingRow>
      <SettingRow
        label={t("settings.terminalNotifications.notifyOnFailure.label")}
        description={t("settings.terminalNotifications.notifyOnFailure.description")}
      >
        <Toggle
          checked={settings.terminalNotifyOnFailure}
          disabled={!settings.terminalNotifications}
          onChange={(next) => updateSettings({ terminalNotifyOnFailure: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.terminalNotifications.notifyOnAttention.label")}
        description={t("settings.terminalNotifications.notifyOnAttention.description")}
      >
        <Toggle
          checked={settings.terminalNotifyOnAttention}
          disabled={!settings.terminalNotifications}
          onChange={(next) => updateSettings({ terminalNotifyOnAttention: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.terminalNotifications.native.label")}
        description={t("settings.terminalNotifications.native.description")}
      >
        <Toggle
          checked={settings.terminalNotifyNative}
          disabled={!settings.terminalNotifications}
          onChange={(next) => updateSettings({ terminalNotifyNative: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.terminalNotifications.sound.label")}
        description={t("settings.terminalNotifications.sound.description")}
      >
        <Toggle
          checked={settings.terminalNotifySound}
          disabled={!settings.terminalNotifications}
          onChange={(next) => updateSettings({ terminalNotifySound: next })}
        />
      </SettingRow>

      <SectionTitle
        title={t("settings.behaviour.sectionTitle")}
        subtitle={t("settings.behaviour.sectionSubtitle")}
      />
      <SettingRow
        label={t("settings.behaviour.autoGitignore.label")}
        description={t("settings.behaviour.autoGitignore.description")}
      >
        <Toggle
          checked={settings.autoAddAtlasGitignore}
          onChange={(next) => updateSettings({ autoAddAtlasGitignore: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.showHiddenFiles.label")}
        description={t("settings.behaviour.showHiddenFiles.description")}
      >
        <Toggle
          checked={settings.showHiddenFiles}
          onChange={(next) => updateSettings({ showHiddenFiles: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.gitBlameInline.label")}
        description={t("settings.behaviour.gitBlameInline.description")}
      >
        <Toggle
          checked={settings.gitBlameInline}
          onChange={(next) => updateSettings({ gitBlameInline: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.enableLogs.label")}
        description={t("settings.behaviour.enableLogs.description")}
      >
        <Toggle
          checked={settings.enableAtlasLogs}
          onChange={(next) => updateSettings({ enableAtlasLogs: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.shareTelemetry.label")}
        description={t("settings.behaviour.shareTelemetry.description")}
      >
        <Toggle
          checked={settings.shareTelemetry}
          onChange={(next) => {
            // Rust re-syncs the live gate itself on every settings commit
            // (`notify_settings_changed`) — this only needs to flip the
            // frontend-only `posthog-js` crash reporter, which Rust can't
            // reach.
            updateSettings({ shareTelemetry: next });
            setTelemetryEnabled(next);
          }}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.linkTelemetryToAccount.label")}
        description={t("settings.behaviour.linkTelemetryToAccount.description")}
      >
        <Toggle
          checked={settings.linkTelemetryToAccount}
          disabled={!settings.shareTelemetry}
          onChange={(next) => updateSettings({ linkTelemetryToAccount: next })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.sendFeedback.label")}
        description={t("settings.behaviour.sendFeedback.description")}
      >
        <button
          type="button"
          onClick={() => useFeedbackStore.getState().actions.openPanel("settings")}
          className={cn(
            "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
            "text-text-primary hover:bg-bg-hover transition-colors",
          )}
        >
          {t("settings.behaviour.sendFeedback.button")}
        </button>
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.adaptiveSuggestions.label")}
        description={t("settings.behaviour.adaptiveSuggestions.description")}
      >
        <Toggle
          checked={settings.adaptiveSuggestions !== "off"}
          onChange={(next) => updateSettings({ adaptiveSuggestions: next ? "agent" : "off" })}
        />
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.cli.label")}
        description={t("settings.behaviour.cli.description", { status: cliInstalledLine })}
      >
        <button
          type="button"
          onClick={() => void installCli()}
          disabled={installing}
          className={cn(
            "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
            "text-text-primary hover:bg-bg-hover transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {installing
            ? t("settings.behaviour.cli.installing")
            : cli?.installed
              ? t("settings.behaviour.cli.reinstall")
              : t("settings.behaviour.cli.install")}
        </button>
      </SettingRow>
      <SettingRow
        label={t("settings.behaviour.modelPricing.label")}
        description={t("settings.behaviour.modelPricing.description", {
          status:
            pricedModelCount > 0
              ? t("settings.behaviour.modelPricing.pricedModels", { count: pricedModelCount })
              : t("settings.behaviour.modelPricing.notYetFetched"),
        })}
      >
        <button
          type="button"
          onClick={() => void updatePricing()}
          disabled={pricingLoading}
          className={cn(
            "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
            "text-text-primary hover:bg-bg-hover transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pricingLoading
            ? t("settings.behaviour.modelPricing.updating")
            : t("settings.behaviour.modelPricing.update")}
        </button>
      </SettingRow>
    </div>
  );
}

type AppearanceTab = "theme" | "accent";

function AppearanceSettings() {
  const { t } = useTranslation();
  const settings = useProjectStore.use.settings();
  const { updateSettings } = useProjectStore.use.actions();
  const [tab, setTab] = useState<AppearanceTab>("accent");

  const APPEARANCE_TABS: { id: AppearanceTab; label: string }[] = [
    { id: "accent", label: t("settings.appearance.tabs.interfaceTheme") },
    { id: "theme", label: t("settings.appearance.tabs.editorTheme") },
  ];

  const scalePct = Math.round(settings.uiScale * 100);
  const setScale = (next: number) => updateSettings({ uiScale: clampScale(next) });
  const zoomHints = [
    useActionShortcut("view.zoomIn")?.label,
    useActionShortcut("view.zoomOut")?.label,
    useActionShortcut("view.zoomReset")?.label,
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — Skills-style underline tabs (no title), zoom on the right. */}
      <div className="flex h-[29px] shrink-0 items-center gap-1 border-b border-border-default px-2">
        {APPEARANCE_TABS.map((tabDef) => (
          <UnderlineTab
            key={tabDef.id}
            active={tab === tabDef.id}
            onClick={() => setTab(tabDef.id)}
            label={tabDef.label}
          />
        ))}

        {/* Interface zoom — right-aligned control (like Skills' scope control). */}
        <div
          className="ml-auto flex items-center gap-1 pr-0.5"
          title={
            zoomHints.length
              ? t("settings.appearance.zoom.titleWithHints", { hints: zoomHints.join(" / ") })
              : t("settings.appearance.zoom.title")
          }
        >
          <button
            type="button"
            aria-label={t("settings.appearance.zoom.zoomOut")}
            onClick={() => setScale(settings.uiScale - SCALE_STEP)}
            disabled={settings.uiScale <= MIN_SCALE}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border border-border-default text-text-secondary",
              "hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={() => setScale(DEFAULT_SCALE)}
            title={t("settings.appearance.zoom.resetTo100")}
            className="h-6 min-w-[44px] rounded-md px-1.5 text-[11px] font-medium tabular-nums text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            {scalePct}%
          </button>
          <button
            type="button"
            aria-label={t("settings.appearance.zoom.zoomIn")}
            onClick={() => setScale(settings.uiScale + SCALE_STEP)}
            disabled={settings.uiScale >= MAX_SCALE}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border border-border-default text-text-secondary",
              "hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "theme" ? <CodeEditorThemesSettings /> : <AtlasThemesSettings />}
      </div>
    </div>
  );
}

/** Underline tab — copied from the Skills header (`skills-and-packs.tsx`). */
function UnderlineTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[29px] items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px cursor-pointer",
        active
          ? "text-text-primary border-b-[var(--accent-primary)]"
          : "text-text-secondary hover:text-text-primary border-b-transparent",
      )}
    >
      {label}
    </button>
  );
}

function UpdatesSettings() {
  const { t } = useTranslation();
  const settings = useProjectStore.use.settings();
  const { updateSettings } = useProjectStore.use.actions();
  const phase = useUpdaterStore.use.phase();
  const version = useUpdaterStore.use.version();
  const progress = useUpdaterStore.use.progress();
  const { beginApply, setError } = useUpdaterStore.use.actions();
  const [checking, setChecking] = useState(false);

  const downloading = phase === "downloading";
  const ready = phase === "ready" || phase === "applying";

  const checkNow = async () => {
    setChecking(true);
    try {
      const status = await updater.checkNow();
      // When an update exists, the background download starts and the store
      // reflects it below; only surface the "up to date" case here.
      if (!status.available) {
        toast.success(
          t("settings.updates.checkForUpdates.upToDate", { version: status.currentVersion }),
        );
      }
    } catch (e) {
      toast.error(
        t("settings.updates.checkForUpdates.checkFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setChecking(false);
    }
  };

  const restart = () => {
    beginApply();
    void updater.apply().catch((e) => setError(String(e)));
  };

  // The "Check for updates" row swaps its control based on the live phase:
  // downloading → progress; ready → Restart button; else → Check now.
  const control = ready ? (
    <button
      type="button"
      onClick={restart}
      className={cn(
        "h-7 rounded-md px-2.5 text-[11px] font-medium",
        "bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 transition-opacity",
      )}
    >
      {t("settings.updates.checkForUpdates.restartToUpdate")}
    </button>
  ) : downloading ? (
    <span className="text-[11px] text-text-tertiary tabular-nums">
      {progress != null
        ? t("settings.updates.checkForUpdates.downloading", {
            percent: Math.round(progress * 100),
          })
        : t("settings.updates.checkForUpdates.preparing")}
    </span>
  ) : (
    <button
      type="button"
      onClick={() => void checkNow()}
      disabled={checking}
      className={cn(
        "h-7 rounded-md px-2.5 text-[11px] font-medium border border-border-default bg-bg-elevated",
        "text-text-primary hover:bg-bg-hover transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {checking
        ? t("settings.updates.checkForUpdates.checking")
        : t("settings.updates.checkForUpdates.checkNow")}
    </button>
  );

  return (
    <div className="space-y-6">
      <SectionTitle
        title={t("settings.updates.sectionTitle")}
        subtitle={t("settings.updates.sectionSubtitle")}
      />
      <SettingRow
        label={t("settings.updates.autoUpdate.label")}
        description={t("settings.updates.autoUpdate.description")}
      >
        <Toggle
          checked={settings.autoUpdate}
          onChange={(next) => updateSettings({ autoUpdate: next })}
        />
      </SettingRow>
      <SettingRow
        label={
          ready
            ? t("settings.updates.checkForUpdates.labelReady", {
                version: version ? ` (${version})` : "",
              })
            : t("settings.updates.checkForUpdates.label")
        }
        description={
          ready
            ? t("settings.updates.checkForUpdates.descriptionReady")
            : t("settings.updates.checkForUpdates.description")
        }
      >
        {control}
      </SettingRow>
    </div>
  );
}

function AboutSettings() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SectionTitle
        title={t("settings.nav.sections.about")}
        subtitle={t("settings.about.sectionSubtitle")}
      />
      <div className="rounded-lg border border-border-default bg-bg-secondary p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AtlasIcon size={40} className="rounded-xl" />
          <div>
            <p className="text-sm font-semibold text-text-primary">İmece</p>
            <p className="text-[10px] text-text-tertiary">{t("settings.about.version")}</p>
          </div>
        </div>
        <p className="text-[11px] text-text-secondary leading-relaxed pt-2">
          {t("settings.about.description")}
        </p>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <p className="text-[11px] text-text-tertiary mt-0.5">{subtitle}</p>
    </div>
  );
}

// Always shown in each language's own name — "Türkçe" reads oddly in an
// English UI and "Turkish" reads oddly in a Turkish one; a language picker's
// own options are the one place that convention (self-naming) is standard.
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  tr: "Türkçe",
  en: "English",
};

function LanguageSetting() {
  const { t, i18n } = useTranslation();
  const current = SUPPORTED_LANGUAGES.includes(i18n.language as SupportedLanguage)
    ? (i18n.language as SupportedLanguage)
    : "tr";

  return (
    <SettingRow
      label={t("settings.general.languageLabel")}
      description={t("settings.general.languageDescription")}
    >
      <select
        value={current}
        onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--text-primary)] outline-none"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_NAMES[lang]}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[12px] font-medium text-text-primary">{label}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Toggle — controlled OR uncontrolled. If `checked` is provided the parent
 * owns the state and `onChange` is fired on click; otherwise we keep
 * internal state seeded by `defaultChecked` (original behavior).
 */
export function Toggle({
  defaultChecked = false,
  checked,
  onChange,
  disabled = false,
}: {
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (next: boolean) => void;
  /** For a sub-setting whose parent is off — dimmed and inert, but still
   *  showing its own stored value rather than lying about it. */
  disabled?: boolean;
}) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const value = isControlled ? checked : internal;
  const apply = (next: boolean) => {
    if (disabled) return;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };
  // shadcn/Radix switch proportions: the track has a 2px transparent
  // border so its inner content area is exactly the thumb's size,
  // making the thumb fill vertically and animate translate-x-0 → -x-4
  // edge to edge. The thumb flips color when ON because Atlas's accent
  // is pure white — a white-on-white thumb would disappear.
  return (
    <button
      onClick={() => apply(!value)}
      role="switch"
      aria-checked={value}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center",
        "rounded-full border-2 border-transparent transition-colors",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        value ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-elevated)]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.45)]",
          "transition-transform duration-150",
          value ? "translate-x-4 bg-[var(--bg-base)]" : "translate-x-0 bg-white",
        )}
      />
    </button>
  );
}

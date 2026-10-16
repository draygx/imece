import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { useActionShortcut } from "@/features/keybindings/lib/use-action-shortcut";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/features/layout/stores/layout-store";
import { LAYOUT_TEMPLATES, type LayoutTemplate } from "@/features/layout/templates";
import { LayoutThumbnail } from "@/features/layout/components/layout-thumbnail";

/** Settings → Layouts: the same predefined templates the ⌘⌥L switcher offers,
 *  applied with a click. */
export function LayoutsSettings() {
  const { t } = useTranslation();
  const switcherHint = useActionShortcut("nav.layoutSwitcher")?.label ?? "⌘⌥L";
  const apply = (template: LayoutTemplate) => {
    useLayoutStore.getState().actions.applyLayoutTemplate(template);
    toast.success(t("layouts.appliedToast", { name: template.name }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{t("layouts.title")}</h2>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          <Trans
            i18nKey="layouts.description"
            values={{ hint: switcherHint }}
            components={{
              kbd: (
                <kbd className="px-1 py-0.5 rounded bg-bg-elevated border border-border-default font-mono text-[9px]" />
              ),
            }}
          />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {LAYOUT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => apply(template)}
            className={cn(
              "text-left rounded-xl border border-border-default bg-bg-secondary p-3",
              "hover:border-[var(--border-strong)] transition-colors outline-none",
            )}
          >
            <LayoutThumbnail template={template} />
            <div className="mt-2 text-[12px] font-medium text-text-primary">{template.name}</div>
            <div className="text-[10px] text-text-tertiary leading-snug">
              {template.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

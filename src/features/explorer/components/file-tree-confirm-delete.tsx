import * as Dialog from "@radix-ui/react-dialog";
import { Trans, useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ConfirmDeleteProps {
  open: boolean;
  /** Display name in the prompt — file/folder basename (first item when
   *  deleting several). */
  name: string;
  /** Whether the target is a directory (changes the warning copy). */
  isDir: boolean;
  /** Number of items being deleted. >1 switches to the batch wording. */
  count?: number;
  /** Override the default "Delete …?" title (e.g. "Revert all changes?"). */
  title?: string;
  /** Override the default body copy. */
  body?: React.ReactNode;
  /** Override the confirm button label (default "Delete"). */
  confirmLabel?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Custom Radix dialog for delete confirmation. `window.confirm` would
 * steal focus and look like a default browser modal — not acceptable
 * for a destructive action on a polished surface like the file tree.
 */
export function FileTreeConfirmDelete({
  open,
  name,
  isDir,
  count = 1,
  title,
  body,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: ConfirmDeleteProps) {
  const { t } = useTranslation();
  const multi = count > 1;
  const resolvedConfirmLabel = confirmLabel ?? t("explorer.confirmDelete.deleteLabel");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[var(--z-overlay)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[30%] -translate-x-1/2 z-[var(--z-modal)]",
            "w-[380px] rounded-xl overflow-hidden",
            "bg-[var(--bg-secondary)] border border-[var(--border-default)]",
            "shadow-[var(--shadow-overlay)]",
            "p-4 flex flex-col gap-3",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            }
          }}
        >
          <Dialog.Title className="text-[13px] font-semibold text-text-primary">
            {title ??
              (multi
                ? t("explorer.confirmDelete.deleteItemsTitle", { count })
                : isDir
                  ? t("explorer.confirmDelete.deleteFolderTitle")
                  : t("explorer.confirmDelete.deleteFileTitle"))}
          </Dialog.Title>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            {body ?? (
              <Trans
                i18nKey={
                  multi
                    ? "explorer.confirmDelete.multiBody"
                    : isDir
                      ? "explorer.confirmDelete.deleteFolderBody"
                      : "explorer.confirmDelete.deleteFileBody"
                }
                values={{ name, count: count - 1 }}
                components={{ bold: <span className="font-mono text-text-primary" /> }}
              />
            )}
          </p>
          <div className="flex items-center justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                "px-3 h-7 rounded text-[11px]",
                "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
              )}
            >
              {t("explorer.confirmDelete.cancel")}
            </button>
            <button
              type="button"
              autoFocus
              onClick={onConfirm}
              className={cn(
                "px-3 h-7 rounded text-[11px] font-medium",
                "text-white bg-[var(--status-error)] hover:opacity-90",
              )}
            >
              {resolvedConfirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

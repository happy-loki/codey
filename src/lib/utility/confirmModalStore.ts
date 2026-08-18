import { writable } from "svelte/store";

export type ConfirmModalOptions = {
    title: string;
    message: string;
    cancelLabel?: string;
    confirmLabel?: string;
    confirmStyle?: "primary" | "secondary" | "accent" | "danger";
};

type ConfirmModalState =
    | {
          open: false;
      }
    | ({
          open: true;
      } & Required<ConfirmModalOptions>);

export const confirmModalState = writable<ConfirmModalState>({ open: false });

let pendingResolver: ((result: boolean) => void) | null = null;

export function resolveConfirmModal(result: boolean) {
    const resolver = pendingResolver;
    pendingResolver = null;
    confirmModalState.set({ open: false });
    if (resolver) resolver(result);
}

export function openConfirmModal(options: ConfirmModalOptions): Promise<boolean> {
    return new Promise((resolve) => {
        if (pendingResolver) {
            const prev = pendingResolver;
            pendingResolver = null;
            try { prev(false); } catch {}
        }
        pendingResolver = resolve;
        confirmModalState.set({
            open: true,
            title: options.title,
            message: options.message,
            cancelLabel: options.cancelLabel ?? "Cancel",
            confirmLabel: options.confirmLabel ?? "OK",
            confirmStyle: options.confirmStyle ?? "danger",
        });
    });
}


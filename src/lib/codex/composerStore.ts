import { writable } from "svelte/store";
import type { UserInput } from "./types";

export type ComposerAttachmentKind = "snippet" | "image";

export interface ComposerAttachment {
    id: string;
    kind: ComposerAttachmentKind;
    label: string;
    input: UserInput;
    previewUrl?: string;
    localPath?: string;
    iconKind?: "file" | "folder";
    iconFilename?: string;
}

export const composerAttachments = writable<ComposerAttachment[]>([]);

export function addAttachment(attachment: ComposerAttachment) {
    composerAttachments.update((current) => [...current, attachment]);
}

export function removeAttachment(id: string) {
    composerAttachments.update((current) => current.filter((att) => att.id !== id));
}

export function clearAttachments() {
    composerAttachments.set([]);
}


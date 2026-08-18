import { writable } from "svelte/store";

export const searchPopupOpen = writable(false);

export function openSearchPopup() {
  searchPopupOpen.set(true);
}

export function closeSearchPopup() {
  searchPopupOpen.set(false);
}


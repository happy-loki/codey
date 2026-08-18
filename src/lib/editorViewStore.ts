import { writable } from "svelte/store";
import type { MonacoInstance } from "./monaco/instance";

export type MonacoEditor = ReturnType<MonacoInstance["editor"]["create"]>;

export const editorViewStore = writable<MonacoEditor | null>(null);



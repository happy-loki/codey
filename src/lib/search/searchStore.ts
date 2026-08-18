import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

export interface SearchSubmatch {
    start: number;
    end: number;
    text: string;
}

export interface SearchMatch {
    line_number: number;
    column: number;
    line: string;
    submatches: SearchSubmatch[];
}

export interface SearchFileResult {
    path: string;
    relative_path: string;
    matches: SearchMatch[];
}

export interface SearchState {
    query: string;
    caseSensitive: boolean;
    includeHidden: boolean;
    isSearching: boolean;
    error: string | null;
    results: SearchFileResult[];
    expanded: Record<string, boolean>;
    pendingRequestId: number;
}

const initialState: SearchState = {
    query: "",
    caseSensitive: true,
    includeHidden: false,
    isSearching: false,
    error: null,
    results: [],
    expanded: {},
    pendingRequestId: 0,
};

export const searchState = writable<SearchState>({ ...initialState });

let requestCounter = 0;

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch (e) {
        return String(error);
    }
}

export function resetSearchState() {
    searchState.set({ ...initialState });
}

export function setSearchQuery(query: string) {
    searchState.update((state) => ({ ...state, query }));
}

export function toggleCaseSensitive(autoRerun = true) {
    searchState.update((state) => {
        const next = { ...state, caseSensitive: !state.caseSensitive };
        return next;
    });
    if (autoRerun && get(searchState).query.trim().length > 0) {
        void runSearch();
    }
}

export function toggleIncludeHidden(autoRerun = true) {
    searchState.update((state) => ({
        ...state,
        includeHidden: !state.includeHidden,
    }));
    if (autoRerun && get(searchState).query.trim().length > 0) {
        void runSearch();
    }
}

export function setCaseSensitive(value: boolean, autoRerun = false) {
    searchState.update((state) => ({ ...state, caseSensitive: value }));
    if (autoRerun && get(searchState).query.trim().length > 0) {
        void runSearch();
    }
}

export function toggleExpand(path: string) {
    searchState.update((state) => {
        const expanded = { ...state.expanded };
        expanded[path] = !expanded[path];
        return { ...state, expanded };
    });
}

export function setAllExpanded(expand: boolean) {
    searchState.update((state) => {
        const expanded: Record<string, boolean> = {};
        for (const file of state.results) {
            expanded[file.path] = expand;
        }
        return { ...state, expanded };
    });
}

export async function runSearch(manualQuery?: string) {
    const current = get(searchState);
    const rawQuery = manualQuery ?? current.query;
    const query = rawQuery.trim();
    const caseSensitive = current.caseSensitive;
    const includeHidden = current.includeHidden;
    const requestId = ++requestCounter;

    if (manualQuery !== undefined) {
        searchState.update((state) => ({ ...state, query: manualQuery }));
    }

    if (query.length === 0) {
        searchState.update((state) => ({
            ...state,
            query: rawQuery,
            isSearching: false,
            error: null,
            results: [],
            expanded: {},
            pendingRequestId: requestId,
        }));
        return;
    }

    searchState.update((state) => ({
        ...state,
        query: rawQuery,
        isSearching: true,
        error: null,
        pendingRequestId: requestId,
    }));

    try {
        const results = await invoke<SearchFileResult[]>("search_workspace", {
            query,
            caseSensitive,
            includeHidden,
        });
        searchState.update((state) => {
            if (state.pendingRequestId !== requestId) {
                return state;
            }
            const expanded: Record<string, boolean> = {};
            for (const file of results) {
                expanded[file.path] = true;
            }
            return {
                ...state,
                results,
                expanded,
                isSearching: false,
                error: null,
            };
        });
    } catch (error) {
        const message = normalizeErrorMessage(error);
        searchState.update((state) => {
            if (state.pendingRequestId !== requestId) {
                return state;
            }
            return {
                ...state,
                isSearching: false,
                error: message,
            };
        });
    }
}

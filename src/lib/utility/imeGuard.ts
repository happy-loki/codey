const DEFAULT_GUARD_MS = 180;

export interface ImeGuardOptions {
    guardMs?: number;
    intercept?: boolean;
    debug?: boolean;
}

interface ListenerRecord {
    target: EventTarget;
    type: string;
    listener: EventListener;
    options: AddEventListenerOptions;
}

interface ImeGuard {
    attach(target: Window | Document): void;
    detach(target?: Window | Document): void;
    shouldBlockEnter(event: KeyboardEvent): boolean;
}

function now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

export function createImeGuard(options: ImeGuardOptions = {}): ImeGuard {
    const guardMs = Math.max(0, options.guardMs ?? DEFAULT_GUARD_MS);
    const intercept = options.intercept ?? false;
    const debug = options.debug ?? false;

    let isComposing = false;
    let compositionEndedAt = 0;
    const listeners: ListenerRecord[] = [];
    const attached = new Set<EventTarget>();

    const addListener = (
        target: EventTarget,
        type: string,
        listener: EventListener
    ) => {
        const opts: AddEventListenerOptions = { capture: true, passive: false };
        target.addEventListener(type, listener, opts);
        listeners.push({ target, type, listener, options: opts });
    };

    const removeListenersForTarget = (target: EventTarget) => {
        for (let i = listeners.length - 1; i >= 0; i -= 1) {
            const record = listeners[i];
            if (record.target === target) {
                record.target.removeEventListener(record.type, record.listener, record.options);
                listeners.splice(i, 1);
            }
        }
    };

    const handleCompositionStart = () => {
        isComposing = true;
    };

    const handleCompositionEnd = () => {
        isComposing = false;
        compositionEndedAt = now();
    };

    const shouldBlock = (event: KeyboardEvent): boolean => {
        if (!event || event.key !== "Enter") {
            return false;
        }
        if (event.isComposing || event.keyCode === 229) {
            return true;
        }
        if (isComposing) {
            return true;
        }
        return now() - compositionEndedAt <= guardMs;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (!shouldBlock(event)) {
            return;
        }
        if (debug) {
            console.debug("[imeGuard] Suppressed Enter during/after IME composition.");
        }
        if (intercept) {
            event.stopImmediatePropagation();
            event.stopPropagation();
        }
    };

    const attach = (target: Window | Document) => {
        if (!target || attached.has(target)) {
            return;
        }
        addListener(target, "compositionstart", handleCompositionStart as EventListener);
        addListener(target, "compositionend", handleCompositionEnd as EventListener);
        addListener(target, "keydown", handleKeyDown as EventListener);
        attached.add(target);
    };

    const detach = (target?: Window | Document) => {
        if (target) {
            if (!attached.has(target)) {
                return;
            }
            removeListenersForTarget(target);
            attached.delete(target);
            return;
        }
        // Detach every target
        for (const item of Array.from(attached)) {
            removeListenersForTarget(item);
            attached.delete(item);
        }
    };

    return {
        attach,
        detach,
        shouldBlockEnter: shouldBlock
    };
}

const hostGuard = createImeGuard({ guardMs: DEFAULT_GUARD_MS, intercept: false });
let hostGuardAttached = false;

export function ensureHostImeGuard(win: Window = window): () => void {
    if (typeof window === "undefined") {
        return () => {};
    }
    if (!hostGuardAttached) {
        try {
            hostGuard.attach(win);
            hostGuardAttached = true;
        } catch {
            // In extremely early boot phases the window might not be ready; swallow errors.
        }
    }
    return () => {
        if (hostGuardAttached) {
            hostGuard.detach(win);
            hostGuardAttached = false;
        }
    };
}

export function attachImeGuardToWindow(win: Window, options?: ImeGuardOptions): () => void {
    const guard = createImeGuard(options);
    guard.attach(win);
    return () => guard.detach(win);
}

export function shouldBlockImeEnter(event: KeyboardEvent): boolean {
    return hostGuard.shouldBlockEnter(event);
}

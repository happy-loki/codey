import WorkerUrl from "@pierre/diffs/worker/worker-portable.js?worker&url";

export function workerFactory(): Worker {
    return new Worker(WorkerUrl, { type: "module" });
}

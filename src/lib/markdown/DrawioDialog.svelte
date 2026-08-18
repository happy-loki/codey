<script lang="ts">
  import { onDestroy } from "svelte";
  import { lang, type Lang } from "../i18n";
  import { t } from "../i18n";
  import { addNotification, NotifType } from "../Notifications/notifications";
  import { drawioDialogState, resolveDrawioDialog, type DrawioDialogState } from "./drawioDialogStore";

  type DrawioMessage =
    | { eventName: "ready"; value?: unknown }
    | { eventName: "getData:success"; value: { xmlData: string; base64: string } }
    | { eventName: "setData:success"; value?: unknown }
    | { eventName: "fatal-error"; value?: { reason?: string } | string };

  let state: DrawioDialogState = {
    open: false,
    mode: "insert",
    initialXml: null,
    requestId: 0,
  };
  let iframeEl: HTMLIFrameElement | null = null;
  let iframeVersion = 0;
  let frameReady = false;
  let submitting = false;
  let pendingInitialXml: string | null = null;
  let currentLang: Lang = "en";
  let keydownBound = false;
  let readyTimeout: ReturnType<typeof setTimeout> | null = null;
  const DRAWIO_THEME = "light";

  const unsubscribeState = drawioDialogState.subscribe((value) => {
    const wasOpen = state.open;
    state = value;
    if (value.open) {
      pendingInitialXml = value.initialXml ?? null;
      if (!wasOpen) {
        openFrame();
        bindKeydown(true);
      } else if (frameReady) {
        syncInitialContent();
      }
    } else if (wasOpen) {
      closeFrame();
      bindKeydown(false);
    }
  });

  const unsubscribeLang = lang.subscribe((value) => {
    currentLang = value;
  });

  const handleMessage = (event: MessageEvent<DrawioMessage>) => {
    if (!state.open || event.source !== iframeEl?.contentWindow) {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.eventName !== "string") {
      return;
    }
    switch (data.eventName) {
      case "ready": {
        frameReady = true;
        clearReadyTimeout();
        sendConfiguration();
        syncInitialContent();
        break;
      }
      case "setData:success": {
        // ignore
        break;
      }
      case "getData:success": {
        submitting = false;
        resolveDrawioDialog(data.value ?? null);
        break;
      }
      case "fatal-error": {
        submitting = false;
        const reason =
          typeof data.value === "string"
            ? data.value
            : data.value && typeof data.value === "object" && "reason" in data.value
              ? String((data.value as { reason?: unknown }).reason ?? "")
              : "";
        const message = reason || "draw 已异常退出";
        addNotification(NotifType.Error, "draw 已关闭", [], message);
        resolveDrawioDialog(null);
        break;
      }
    }
  };

  const targetOrigin = typeof window !== "undefined" ? window.location.origin : "*";

  if (typeof window !== "undefined") {
    window.addEventListener("message", handleMessage);
  }

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", handleMessage);
      bindKeydown(false);
    }
    unsubscribeState();
    unsubscribeLang();
    // no-op for theme unsubscribe (we no longer listen to global theme changes)
  });

  function openFrame() {
    frameReady = false;
    submitting = false;
    iframeVersion = state.requestId || Date.now();
    startReadyTimeout();
    setTimeout(() => {
      postMessage("ready?");
      sendConfiguration();
      syncInitialContent();
    }, 0);
  }

  function closeFrame() {
    frameReady = false;
    submitting = false;
    pendingInitialXml = null;
    iframeEl = null;
    clearReadyTimeout();
  }

  function postMessage(eventName: string, value?: unknown) {
    iframeEl?.contentWindow?.postMessage({ eventName, value }, targetOrigin || "*");
  }

  function syncInitialContent() {
    if (!frameReady || pendingInitialXml == null) {
      return;
    }
    clearReadyTimeout();
    postMessage("setData", pendingInitialXml);
    pendingInitialXml = null;
  }

  function sendConfiguration() {
    if (!frameReady) return;
    postMessage("configure", {
      language: currentLang,
      theme: DRAWIO_THEME,
    });
  }

  function handleCancel() {
    if (submitting) return;
    resolveDrawioDialog(null);
  }

  function handleSubmit() {
    if (!frameReady || submitting) return;
    submitting = true;
    postMessage("getData");
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      handleCancel();
    }
  }

  function bindKeydown(active: boolean) {
    if (typeof window === "undefined") return;
    if (active && !keydownBound) {
      window.addEventListener("keydown", handleKeydown, { capture: true });
      keydownBound = true;
    } else if (!active && keydownBound) {
      window.removeEventListener("keydown", handleKeydown, { capture: true });
      keydownBound = false;
    }
  }

  const iframeSrc = () => `/drawio/index.html?lang=${currentLang}&v=${iframeVersion}`;

  function startReadyTimeout() {
    clearReadyTimeout();
    readyTimeout = setTimeout(() => {
      if (!state.open || frameReady) return;
      submitting = false;
      addNotification(NotifType.Error, "draw 加载失败", [], "draw 未响应，已自动关闭");
      resolveDrawioDialog(null);
    }, 10000);
  }

  function clearReadyTimeout() {
    if (readyTimeout != null) {
      clearTimeout(readyTimeout);
      readyTimeout = null;
    }
  }
</script>

{#if state.open}
  <div class="drawio-root" role="dialog" aria-modal="true" aria-label="draw editor">
    <iframe
      class="drawio-frame"
      title="draw editor"
      bind:this={iframeEl}
      src={iframeSrc()}
      allow="clipboard-write"
      allowfullscreen
    />
    <div class="drawio-controls">
      <span class="drawio-title">
        {$t(state.mode === "edit" ? "markdown.drawio.titleEdit" : "markdown.drawio.titleInsert")}
      </span>
      <div class="drawio-actions">
        <button type="button" class="drawio-btn drawio-btn--ghost" on:click={handleCancel} disabled={submitting}>
          {$t("markdown.drawio.cancel")}
        </button>
        <button type="button" class="drawio-btn drawio-btn--primary" on:click={handleSubmit} disabled={!frameReady || submitting}>
          {$t("markdown.drawio.confirm")}
        </button>
      </div>
    </div>
    <button class="drawio-close" aria-label={$t("markdown.drawio.close")} on:click={handleCancel}>×</button>
  </div>
{/if}

<style lang="scss">
.drawio-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: transparent;
  color: var(--window-foreground, #0f172a);
}

.drawio-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

.drawio-controls {
  position: absolute;
  bottom: 24px;
  right: 72px;
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.75);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(12px);
}

.drawio-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.drawio-actions {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.drawio-btn {
  min-width: 120px;
  border-radius: 10px;
  font-size: 15px;
  padding: 10px 18px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
}

.drawio-btn--ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.35);
  color: inherit;

  &:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.16);
  }
}

.drawio-btn--primary {
  background: #ffffff;
  color: #0f172a;

  &:not(:disabled):hover {
    transform: translateY(-1px);
  }
}

.drawio-close {
  position: absolute;
  top: 18px;
  right: 24px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.75);
  color: #ffffff;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.3);
  transition: transform 0.15s ease, background 0.15s ease;

  &:hover {
    background: rgba(15, 23, 42, 0.9);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
}
</style>

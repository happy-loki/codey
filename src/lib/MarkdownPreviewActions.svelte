<script lang="ts">
  import { get } from "svelte/store";
  import { onDestroy, onMount } from "svelte";

  import {
    BookOpen,
    Rocket,
    Monitor,
    Smartphone,
    ImageDown
  } from "lucide-svelte";

  import { copyPlatformHtml, exportPreviewImage, generateWechatHtml } from "./markdown/platformExport";
  import { previewDevice, togglePreviewDevice, type PreviewDevice } from "./markdown/previewDeviceStore";
  import { addNotification, NotifType, updateNotification } from "./Notifications/notifications";
  import { appSettings } from "../config/config";
  import { invoke } from "@tauri-apps/api/core";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { open } from "@tauri-apps/plugin-dialog";
  import Button from "./utility/Button.svelte";
  import Input from "./utility/Input.svelte";
  import Popup from "./utility/Popup.svelte";
  import { activeDoc, activeInfo } from "./editorBus";
  import { getCurrentEditor } from "./EditorTabList.svelte";
  import { updateSaveState } from "./File";
  import {
    applyWechatMeta,
    composeMarkdown,
    extractWechatMeta,
    parseMarkdown,
    type ParseMarkdownResult,
    type WechatDraftMeta
  } from "./markdown/wechatFrontmatter";
  import { _openPopup } from "../App.svelte";

  type PlatformKey = "wechat" | "zhihu" | "juejin";
  const SHOW_PENDING_PREVIEW_ACTIONS = false;

  type WechatSettings = {
    appId: string;
    appSecret: string;
  };

  const DEFAULT_WECHAT_SETTINGS: WechatSettings = {
    appId: "",
    appSecret: ""
  };

  let currentDevice: PreviewDevice = "pc";
  let runningPlatform: PlatformKey | null = null;
  let exportingImage = false;
  let wechatSettings: WechatSettings = { ...DEFAULT_WECHAT_SETTINGS };
  let wechatEnabled = false;
  let unsubscribeWechat: UnlistenFn | null = null;
  let unsubscribeActiveInfo: (() => void) | null = null;
  let activeMarkdownPath: string | null = null;

  function assignWechatUnlisten(handle: unknown) {
    if (typeof handle === "function") {
      unsubscribeWechat = handle as UnlistenFn;
    } else if (handle) {
      console.warn("Unexpected wechat unlisten handle", handle);
      unsubscribeWechat = null;
    } else {
      unsubscribeWechat = null;
    }
  }

  const unsubscribe = previewDevice.subscribe((value) => {
    currentDevice = value;
  });

  onMount(async () => {
    unsubscribeActiveInfo = activeInfo.subscribe((info) => {
      activeMarkdownPath = typeof info?.path === "string" ? info.path : null;
    });

    const store = await appSettings;
    const initial = await store.get("wechat");
    updateWechatState(initial);
    try {
      const unlisten = await store.onKeyChange("wechat", (value: unknown) => {
        updateWechatState(value);
      });
      assignWechatUnlisten(unlisten);
    } catch (err) {
      console.error("Failed to observe wechat settings", err);
      unsubscribeWechat = null;
    }
  });

  onDestroy(() => {
    unsubscribe();
    if (typeof unsubscribeActiveInfo === "function") {
      unsubscribeActiveInfo();
      unsubscribeActiveInfo = null;
    }
    if (typeof unsubscribeWechat === "function") {
      try {
        void unsubscribeWechat();
      } catch (err) {
        console.warn("Failed to dispose wechat listener", err);
      }
      unsubscribeWechat = null;
    } else {
      unsubscribeWechat = null;
    }
  });

  function coerceString(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }
    return "";
  }

  function normalizeWechatSettings(value: unknown): WechatSettings {
    const normalized: WechatSettings = { ...DEFAULT_WECHAT_SETTINGS };
    if (value && typeof value === "object") {
      const source = value as Record<string, unknown>;
      normalized.appId = coerceString(source.appId);
      normalized.appSecret = coerceString(source.appSecret);
    }
    return normalized;
  }

  function updateWechatState(value: unknown) {
    wechatSettings = normalizeWechatSettings(value);
    wechatEnabled = Boolean(wechatSettings.appId && wechatSettings.appSecret);
  }

  function queryPreviewText(selector: string): string {
    if (typeof document === "undefined") {
      return "";
    }
    const element = document.querySelector<HTMLElement>(`.markdown-preview #nice ${selector}`);
    return element?.textContent?.trim() ?? "";
  }

  function resolveWechatTitle(): string {
    const heading = queryPreviewText("h1");
    if (heading) {
      return heading;
    }
    return "未命名草稿";
  }

  function resolveWechatDigest(): string | undefined {
    const paragraph = queryPreviewText("p");
    return paragraph ? paragraph : undefined;
  }

  type PublishWechatDraftResult = {
    mediaId: string;
    itemId?: number;
  };

  type UploadWechatThumbResult = {
    mediaId: string;
  };

  type WechatDraftFormState = {
    title: string;
    author: string;
    summary: string;
    coverPath: string;
    coverMediaId: string;
    mediaId?: string;
    itemId?: number;
  };

  let wechatModalVisible = false;
  let wechatModalPending = false;
  let wechatModalCoverUploading = false;
  let wechatModalError = "";
  let wechatModalResolver: ((result: boolean) => void) | null = null;
  let wechatModalClosing = false;
  let wechatFormState: WechatDraftFormState = {
    title: "",
    author: "",
    summary: "",
    coverPath: "",
    coverMediaId: "",
    mediaId: undefined,
    itemId: undefined
  };
  let wechatParseSnapshot: ParseMarkdownResult | null = null;

  function resetWechatModalState(initial: Partial<WechatDraftFormState> = {}) {
    wechatFormState = {
      title: initial.title ?? "",
      author: initial.author ?? "",
      summary: initial.summary ?? "",
      coverPath: initial.coverPath ?? "",
      coverMediaId: initial.coverMediaId ?? "",
      mediaId: initial.mediaId,
      itemId: initial.itemId
    };
    wechatModalPending = false;
    wechatModalCoverUploading = false;
    wechatModalError = "";
  }

  function openWechatModal(initial: Partial<WechatDraftFormState>): Promise<boolean> {
    if (wechatModalResolver) {
      const resolver = wechatModalResolver;
      wechatModalResolver = null;
      try {
        resolver(false);
      } catch {}
    }
    resetWechatModalState(initial);
    wechatModalClosing = false;
    wechatModalVisible = true;
    try {
      _openPopup.set(true);
    } catch {}
    return new Promise<boolean>((resolve) => {
      wechatModalResolver = resolve;
    });
  }

  function resolveWechatModal(result: boolean) {
    const resolver = wechatModalResolver;
    wechatModalResolver = null;
    wechatModalClosing = true;
    wechatModalVisible = false;
    wechatModalPending = false;
    wechatModalCoverUploading = false;
    wechatModalError = "";
    try {
      _openPopup.set(false);
    } catch {}
    if (resolver) {
      try {
        resolver(result);
      } catch (err) {
        console.warn("Failed to resolve WeChat modal promise", err);
      }
    }
    queueMicrotask(() => {
      wechatModalClosing = false;
    });
  }

  function cancelWechatModal() {
    resolveWechatModal(false);
  }

  $: if (!wechatModalVisible && wechatModalResolver && !wechatModalClosing) {
    resolveWechatModal(false);
  }

  function getActiveMarkdownContent(): string {
    const current = get(activeDoc);
    if (typeof current === "string") {
      return current;
    }
    const editor = getCurrentEditor();
    if (editor && typeof editor.getFileContent === "function") {
      try {
        return editor.getFileContent();
      } catch (err) {
        console.warn("Failed to read active editor content", err);
      }
    }
    return "";
  }

  function syncEditorContent(nextContent: string) {
    const editor = getCurrentEditor();
    try {
      if (editor && typeof editor.setExternalContent === "function") {
        editor.setExternalContent(nextContent);
      }
      activeDoc.set(nextContent);
      updateSaveState(false);
    } catch (err) {
      console.warn("Failed to apply markdown update", err);
    }
  }

  function buildWechatFormFromMeta(meta: WechatDraftMeta): WechatDraftFormState {
    return {
      title: meta.title ?? resolveWechatTitle(),
      author: meta.author ?? "",
      summary: meta.summary ?? resolveWechatDigest() ?? "",
      coverPath: meta.cover ?? "",
      coverMediaId: meta.coverMediaId ?? "",
      mediaId: meta.mediaId,
      itemId: meta.itemId
    };
  }

  async function handleWechatCoverPick() {
    if (wechatModalCoverUploading) {
      return;
    }
    const selection = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp"] }]
    });
    const filePath = Array.isArray(selection) ? selection[0] : selection;
    if (!filePath) {
      return;
    }
    wechatModalCoverUploading = true;
    wechatModalError = "";
    try {
      const result = await invoke<UploadWechatThumbResult>("upload_wechat_thumb", { path: filePath });
      wechatFormState.coverPath = filePath;
      wechatFormState.coverMediaId = result.mediaId;
      addNotification(NotifType.Success, "封面上传成功", [], `MediaId：${result.mediaId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      wechatModalError = message;
      addNotification(NotifType.Error, "封面上传失败", [], message);
    } finally {
      wechatModalCoverUploading = false;
    }
  }

  function clearWechatCover() {
    if (wechatModalCoverUploading) {
      return;
    }
    wechatFormState.coverPath = "";
    wechatFormState.coverMediaId = "";
  }

  function applyWechatMetadataToDocument(
    updates: Partial<WechatDraftFormState>,
    persistMediaIds: { mediaId?: string; itemId?: number } = {}
  ) {
    if (!wechatParseSnapshot) {
      return;
    }
    const currentAttributes = wechatParseSnapshot.attributes;
    const existingMeta = extractWechatMeta(currentAttributes);
    const mergedMeta: WechatDraftMeta = {
      ...existingMeta,
      title: updates.title ?? existingMeta.title,
      author: updates.author ?? existingMeta.author,
      summary: updates.summary ?? existingMeta.summary,
      cover: updates.coverPath ?? existingMeta.cover,
      coverMediaId: updates.coverMediaId ?? existingMeta.coverMediaId,
      mediaId: persistMediaIds.mediaId ?? updates.mediaId ?? existingMeta.mediaId,
      itemId: persistMediaIds.itemId ?? updates.itemId ?? existingMeta.itemId
    };
    const nextAttributes = applyWechatMeta(currentAttributes, mergedMeta);
    const nextMarkdown = composeMarkdown(nextAttributes, wechatParseSnapshot.body);
    const markdownText = getActiveMarkdownContent();
    if (nextMarkdown !== markdownText) {
      syncEditorContent(nextMarkdown);
      wechatParseSnapshot = parseMarkdown(nextMarkdown);
    } else {
      wechatParseSnapshot = {
        ...wechatParseSnapshot,
        attributes: nextAttributes
      };
    }
  }

  function validateWechatForm(): string | null {
    const { title, author, summary, coverMediaId } = wechatFormState;
    if (!title.trim()) return "请填写草稿标题";
    if (!author.trim()) return "请填写作者";
    if (!summary.trim()) return "请填写摘要";
    if (!coverMediaId.trim()) {
      return "请上传封面图";
    }
    return null;
  }

  async function confirmWechatModal() {
    if (wechatModalPending || wechatModalCoverUploading) {
      return;
    }
    wechatModalError = "";
    const validationError = validateWechatForm();
    if (validationError) {
      wechatModalError = validationError;
      return;
    }
    wechatModalPending = true;
    try {
      wechatFormState = {
        ...wechatFormState,
        title: wechatFormState.title.trim(),
        author: wechatFormState.author.trim(),
        summary: wechatFormState.summary.trim(),
        coverPath: wechatFormState.coverPath.trim(),
        coverMediaId: wechatFormState.coverMediaId.trim()
      };

      applyWechatMetadataToDocument(
        {
          title: wechatFormState.title,
          author: wechatFormState.author,
          summary: wechatFormState.summary,
          coverPath: wechatFormState.coverPath,
          coverMediaId: wechatFormState.coverMediaId
        },
        {
          mediaId: wechatFormState.mediaId,
          itemId: wechatFormState.itemId
        }
      );
      resolveWechatModal(true);
    } finally {
      wechatModalPending = false;
    }
  }

  async function handleWechatClick() {
    if (runningPlatform || exportingImage) return;

    if (!wechatEnabled) {
      await handlePlatform("wechat");
      return;
    }

    const markdownText = getActiveMarkdownContent();
    if (!markdownText.trim()) {
      addNotification(NotifType.Warning, "未找到内容", [], "请先打开需要发布的 Markdown 文件");
      return;
    }

    runningPlatform = "wechat";
    let progressNotificationId: number | null = null;
    try {
      wechatParseSnapshot = parseMarkdown(markdownText);
      const currentMeta = extractWechatMeta(wechatParseSnapshot.attributes);
      const initialForm = buildWechatFormFromMeta(currentMeta);
      const confirmed = await openWechatModal(initialForm);
      if (!confirmed) {
        return;
      }

      const latestSnapshot = wechatParseSnapshot ?? parseMarkdown(getActiveMarkdownContent());
      const latestMeta = extractWechatMeta(latestSnapshot.attributes);
      const title = latestMeta.title?.trim() || resolveWechatTitle();
      const digest = latestMeta.summary?.trim();
      const author = latestMeta.author?.trim();
      const mediaId = latestMeta.mediaId?.trim();
      const itemId = latestMeta.itemId;
      const thumb = latestMeta.coverMediaId?.trim();
      if (!thumb) {
        addNotification(NotifType.Error, "缺少封面素材", [], "请上传封面图");
        return;
      }

      progressNotificationId = addNotification(
        NotifType.Message,
        "准备发布公众号草稿",
        [],
        "正在整理草稿内容…"
      );

      const html = await generateWechatHtml();

      const imageCount = (html.match(/<img\b/gi) ?? []).length;
      if (progressNotificationId !== null) {
        updateNotification(progressNotificationId, {
          title: "整理草稿内容完成",
          message:
            imageCount > 0
              ? `检测到 ${imageCount} 张正文图片，正在准备上传，这可能需要几秒。`
              : "未检测到正文图片，正在准备提交草稿。"
        });
      }

      const payload: Record<string, unknown> = {
        title,
        contentHtml: html,
        thumbMediaId: thumb
      };

      if (activeMarkdownPath && activeMarkdownPath.trim().length > 0) {
        payload.sourcePath = activeMarkdownPath;
      }

      if (digest) {
        payload.digest = digest;
      }
      if (author) {
        payload.author = author;
      }
      if (mediaId) {
        payload.mediaId = mediaId;
      }
      if (typeof itemId === "number" && Number.isFinite(itemId)) {
        payload.itemId = itemId;
      }

      if (progressNotificationId !== null) {
        updateNotification(progressNotificationId, {
          title: imageCount > 0 ? "上传正文图片" : "提交草稿",
          message:
            imageCount > 0
              ? `正在上传正文图片（共 ${imageCount} 张），请保持应用开启。`
              : "正在向公众号提交草稿，请稍候。"
        });
      }

      const result = await invoke<PublishWechatDraftResult>("publish_wechat_draft", { args: payload });

      if (progressNotificationId !== null) {
        const lines = [
          `草稿标题：${title}`,
          `草稿 MediaId：${result.mediaId}`,
          result.itemId != null ? `草稿 ItemId：${result.itemId}` : null,
          imageCount > 0 ? `正文图片：已处理 ${imageCount} 张` : "正文图片：无",
          "可前往公众号后台在“内容管理-草稿箱”继续编辑。"
        ].filter(Boolean);

        updateNotification(progressNotificationId, {
          title: "草稿发布成功",
          message: lines.join("\n"),
          type: NotifType.Message
        });
      } else {
        const detail = result.itemId != null
          ? `mediaId: ${result.mediaId}, itemId: ${result.itemId}`
          : `mediaId: ${result.mediaId}`;
        addNotification(NotifType.Message, "草稿发布成功", [], detail);
      }

      wechatFormState = {
        ...wechatFormState,
        mediaId: result.mediaId,
        itemId: result.itemId ?? itemId ?? undefined
      };

      applyWechatMetadataToDocument(
        {
          title,
          author: author ?? "",
          summary: digest ?? "",
          coverPath: wechatFormState.coverPath,
          coverMediaId: wechatFormState.coverMediaId,
          mediaId: result.mediaId,
          itemId: result.itemId ?? itemId ?? undefined
        },
        {
          mediaId: result.mediaId,
          itemId: result.itemId ?? itemId
        }
      );
    } catch (error) {
      console.error("发布微信公众号草稿失败", error);
      const message = error instanceof Error ? error.message : String(error);
      if (progressNotificationId !== null) {
        updateNotification(progressNotificationId, {
          title: "草稿发布失败",
          message,
          type: NotifType.Error
        });
      } else {
        addNotification(NotifType.Error, "草稿发布失败", [], message);
      }
    } finally {
      runningPlatform = null;
    }
  }

  async function handlePlatform(platform: PlatformKey) {
    if (runningPlatform || exportingImage) return;
    runningPlatform = platform;
    try {
      await copyPlatformHtml(platform);
    } finally {
      runningPlatform = null;
    }
  }

  async function handleImageExport() {
    if (runningPlatform || exportingImage) return;
    exportingImage = true;
    try {
      await exportPreviewImage();
    } finally {
      exportingImage = false;
    }
  }

  function handleTogglePreview() {
    togglePreviewDevice();
  }
</script>

{#if wechatModalVisible}
  <Popup bind:open={wechatModalVisible} title="发布公众号草稿" description="完善微信草稿的必填信息">
    <div class="wechat-modal">
      <Input
        label="标题"
        placeholder="请输入草稿标题"
        bind:value={wechatFormState.title}
      />
      <Input
        label="作者"
        placeholder="请输入作者"
        bind:value={wechatFormState.author}
      />
      <div class="wechat-field">
        <label>封面</label>
        <div class="wechat-cover-row">
          <span class:empty={!wechatFormState.coverMediaId}>
            {#if wechatFormState.coverPath}
              {wechatFormState.coverPath}
            {:else if wechatFormState.coverMediaId}
              已关联 MediaId：{wechatFormState.coverMediaId}
            {:else}
              尚未选择封面图
            {/if}
          </span>
          <button
            type="button"
            class="link"
            on:click={handleWechatCoverPick}
            disabled={wechatModalCoverUploading}
          >
            {wechatModalCoverUploading ? "上传中…" : "选择封面"}
          </button>
          {#if wechatFormState.coverMediaId}
            <button
              type="button"
              class="link"
              on:click={clearWechatCover}
              disabled={wechatModalCoverUploading}
            >
              清除
            </button>
          {/if}
        </div>
      </div>
      <div class="wechat-field">
        <label for="wechat-summary">摘要 <span class="limit-hint">（限制120个字）</span></label>
        <textarea
          id="wechat-summary"
          rows="4"
          bind:value={wechatFormState.summary}
          placeholder="用于微信草稿摘要显示"
        ></textarea>
      </div>
      {#if wechatFormState.mediaId}
        <div class="wechat-field readonly">
          <label>现有 media_id</label>
          <div class="wechat-meta-text">{wechatFormState.mediaId}</div>
        </div>
      {/if}
      {#if wechatModalError}
        <div class="wechat-modal-error">{wechatModalError}</div>
      {/if}
    </div>
    <svelte:fragment slot="buttons">
      <Button
        label="取消"
        style="secondary"
        disabled={wechatModalPending || wechatModalCoverUploading}
        on:click={cancelWechatModal}
      />
      <Button
        label={wechatModalPending ? "处理中…" : "确定"}
        style="primary"
        disabled={wechatModalPending || wechatModalCoverUploading}
        on:click={confirmWechatModal}
      />
    </svelte:fragment>
  </Popup>
{/if}

<div class="preview-actions">
  <button
    type="button"
    class="wechat-action"
    class:busy={runningPlatform === "wechat"}
    aria-label={wechatEnabled ? "发布公众号草稿" : "复制为微信排版"}
    title={wechatEnabled ? "发布微信公众号草稿" : "导出微信格式"}
    on:click={handleWechatClick}
    disabled={runningPlatform !== null || exportingImage}
  >
    <span class="wechat-mark" aria-hidden="true">
      <span class="wechat-mark-large"></span>
      <span class="wechat-mark-small"></span>
    </span>
    <span>{wechatEnabled ? "发布草稿" : "微信"}</span>
  </button>

  {#if SHOW_PENDING_PREVIEW_ACTIONS}
    <button
      type="button"
      class:busy={runningPlatform === "zhihu"}
      aria-label="复制为知乎排版"
      title="导出知乎格式"
      on:click={() => handlePlatform("zhihu")}
      disabled={runningPlatform !== null || exportingImage}
    >
      <BookOpen size={18} />
      <span>知乎</span>
    </button>

    <button
      type="button"
      class:busy={runningPlatform === "juejin"}
      aria-label="复制为掘金排版"
      title="导出掘金格式"
      on:click={() => handlePlatform("juejin")}
      disabled={runningPlatform !== null || exportingImage}
    >
      <Rocket size={18} />
      <span>掘金</span>
    </button>

    <button
      type="button"
      aria-label="切换预览设备"
      title={currentDevice === "pc" ? "切换到移动端预览" : "切换到桌面端预览"}
      on:click={handleTogglePreview}
      disabled={runningPlatform !== null || exportingImage}
    >
      {#if currentDevice === "pc"}
        <Smartphone size={18} />
        <span>移动</span>
      {:else}
        <Monitor size={18} />
        <span>桌面</span>
      {/if}
    </button>

    <button
      type="button"
      class:busy={exportingImage}
      aria-label="导出预览图片"
      title="导出为图片"
      on:click={handleImageExport}
      disabled={runningPlatform !== null || exportingImage}
    >
      <ImageDown size={18} />
      <span>图片</span>
    </button>
  {/if}
</div>

<style lang="scss">
.wechat-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 320px;
}

.wechat-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  label {
    font-size: 0.9rem;
    font-weight: 600;
    color: rgba(55, 65, 81, 1);

    .limit-hint {
      font-size: 0.8rem;
      font-weight: 500;
      color: #dc2626;
      margin-left: 4px;
    }
  }

  textarea {
    width: 100%;
    min-height: 96px;
    padding: 0.6rem 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 6px;
    resize: vertical;
    font: inherit;
    background: #fff;
    color: rgba(55, 65, 81, 1);
  }
}

.wechat-field.readonly {
  color: rgba(71, 85, 105, 0.9);

  .wechat-meta-text {
    padding: 0.5rem 0.75rem;
    border: 1px dashed rgba(148, 163, 184, 0.6);
    border-radius: 6px;
    font-size: 0.85rem;
    word-break: break-all;
  }
}

.wechat-cover-row {
  display: flex;
  align-items: center;
  gap: 12px;

  span {
    flex: 1;
    font-size: 0.85rem;
    color: rgba(55, 65, 81, 0.9);
    word-break: break-all;

    &.empty {
      color: rgba(100, 116, 139, 0.8);
    }
  }

  .link {
    background: none;
    border: none;
    color: #2563eb;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0;
  }

  .link:disabled {
    color: rgba(148, 163, 184, 0.8);
    cursor: not-allowed;
  }
}

.wechat-modal-error {
  font-size: 0.85rem;
  color: #dc2626;
}

.preview-actions {
  position: absolute;
  top: 80px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 3;

  button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.9);
    color: inherit;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    font-size: 12px;
    line-height: 1;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    &.busy {
      opacity: 0.6;
    }
  }

  .wechat-action {
    background: #07c160;
    color: #ffffff;
    font-weight: 600;

    &:hover {
      background: #06ad56;
    }

    &:disabled {
      background: #07c160;
    }
  }

  .wechat-mark {
    position: relative;
    width: 22px;
    height: 18px;
    flex: 0 0 22px;
  }

  .wechat-mark-large,
  .wechat-mark-small {
    position: absolute;
    display: block;
    border-radius: 999px;
    background: #ffffff;
  }

  .wechat-mark-large {
    left: 0;
    top: 1px;
    width: 15px;
    height: 12px;
  }

  .wechat-mark-large::after {
    content: "";
    position: absolute;
    left: 4px;
    bottom: -3px;
    border-width: 4px 4px 0 0;
    border-style: solid;
    border-color: #ffffff transparent transparent transparent;
  }

  .wechat-mark-small {
    right: 0;
    bottom: 0;
    width: 13px;
    height: 10px;
    box-shadow: 0 0 0 1.5px #07c160;
  }

  .wechat-mark-small::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: -3px;
    border-width: 3px 0 0 4px;
    border-style: solid;
    border-color: transparent transparent transparent #ffffff;
  }

  span {
    pointer-events: none;
    user-select: none;
  }
}

:global(.dark) .preview-actions button:not(.wechat-action),
:global(html[data-theme="dark"]) .preview-actions button:not(.wechat-action) {
  background: var(--preview-toolbar-surface, rgba(28, 34, 44, 0.92));
  color: var(--preview-text, #e5e7eb);
  border: 1px solid var(--preview-toolbar-border, rgba(148, 163, 184, 0.16));
  box-shadow: var(--preview-toolbar-shadow, 0 8px 20px rgba(0, 0, 0, 0.4));

  &:hover {
    box-shadow: var(--preview-toolbar-shadow, 0 12px 26px rgba(0, 0, 0, 0.45));
  }

  &:disabled {
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
  }
}

:global(.dark) .preview-actions button:not(.wechat-action) {
  border: 1px solid var(--preview-toolbar-border, rgba(148, 163, 184, 0.16));
  background: var(--preview-toolbar-surface, rgba(28, 34, 44, 0.92));
  color: var(--preview-text, inherit);
  box-shadow: var(--preview-toolbar-shadow, 0 6px 18px rgba(0, 0, 0, 0.35));

  &:hover {
    box-shadow: var(--preview-toolbar-shadow, 0 10px 24px rgba(0, 0, 0, 0.4));
  }

  &:disabled {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
}

:global(.dark) .wechat-field label,
:global(html[data-theme="dark"]) .wechat-field label {
  color: rgba(229, 231, 235, 0.95);

  :global(.limit-hint) {
    color: #f87171;
  }
}

:global(.dark) .wechat-field textarea,
:global(html[data-theme="dark"]) .wechat-field textarea {
  background: rgba(30, 41, 59, 0.6);
  border-color: rgba(148, 163, 184, 0.25);
  color: rgba(229, 231, 235, 0.95);

  &::placeholder {
    color: rgba(148, 163, 184, 0.6);
  }
}

:global(.dark) .wechat-field.readonly,
:global(html[data-theme="dark"]) .wechat-field.readonly {
  color: rgba(203, 213, 225, 0.9);

  .wechat-meta-text {
    background: rgba(30, 41, 59, 0.4);
    border-color: rgba(148, 163, 184, 0.3);
    color: rgba(203, 213, 225, 0.9);
  }
}

:global(.dark) .wechat-cover-row span,
:global(html[data-theme="dark"]) .wechat-cover-row span {
  color: rgba(229, 231, 235, 0.9);

  &.empty {
    color: rgba(148, 163, 184, 0.8);
  }
}

:global(.dark) .wechat-cover-row .link,
:global(html[data-theme="dark"]) .wechat-cover-row .link {
  color: #60a5fa;

  &:disabled {
    color: rgba(148, 163, 184, 0.5);
  }
}

:global(.dark) .wechat-modal-error,
:global(html[data-theme="dark"]) .wechat-modal-error {
  color: #f87171;
}
</style>

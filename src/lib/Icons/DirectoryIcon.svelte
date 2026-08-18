<script lang="ts">
  import { is_dark_theme } from "../../config/themehandler";
  import { getThemedIconUrl } from "./fileIconMap";
  export let expanded: boolean = false;

  const FOLDER_CLOSED_CANDIDATES_DARK = ["_folder_dark", "_folder", "folder", "_file", "file"];
  const FOLDER_CLOSED_CANDIDATES_LIGHT = ["_folder", "folder", "_file", "file"];
  const FOLDER_OPEN_CANDIDATES = ["_folder_open", "folder_open", "_folder_dark", "_folder", "folder", "_file", "file"];

  $: theme = $is_dark_theme ? "dark" : "light";
  $: closed = getThemedIconUrl(
        theme === "dark" ? "_folder_dark" : "_folder",
        theme,
        theme === "dark" ? FOLDER_CLOSED_CANDIDATES_DARK.slice(1) : FOLDER_CLOSED_CANDIDATES_LIGHT.slice(1)
    );
  $: opened = getThemedIconUrl("_folder_open", theme, FOLDER_OPEN_CANDIDATES.slice(1)) || closed;
  $: url = expanded ? opened : closed;
</script>

{#if url}
  <img alt="folder" class="folder-icon" src={url} width="16" height="16" />
{/if}

<style>
  .folder-icon {
    display: inline-block;
    vertical-align: middle;
    margin-right: 3px;
  }
  img { pointer-events: none; }
</style>

<script lang="ts">
    import File from "./File.svelte";
    import { getIconUrlForFile } from "./fileIconMap";
    import { is_dark_theme } from "../../config/themehandler";

    export let filename: string;

    $: iconUrl = getIconUrlForFile(filename, $is_dark_theme ? "dark" : "light");
</script>

{#if iconUrl}
    <img alt="file icon" class="file-icon" src={iconUrl} width="16" height="16" />
{:else}
    <File />
{/if}

<style>
  .file-icon {
    display: inline-block;
    vertical-align: middle;
    margin-right: 3px;
  }
</style>

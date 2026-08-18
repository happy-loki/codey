<script lang="ts">
    import { FileX2 } from "lucide-svelte";
    import { openInExplorer } from "../File";
    export let hidden = false;
    export let path = "";

    function handleOpen() {
        if (!path) return;
        openInExplorer(path);
    }
</script>

<div class="container" class:hidden>
    <div class="unsupported">
        <FileX2 size={32} />
        <span class="desc">The file cannot be displayed because it is either binary or uses an unsupported text encoding.</span>
        <span class="link" on:click={handleOpen}>Open in File Explorer</span>
    </div>
</div>

<style lang="scss">
    .container {
        height: 100%;
        display: flex;
        .unsupported {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 60%;
            width: 100%;
            :global(svg) {
                width: 48px;
                height: 48px;
                padding: 20px 0;
            }
            .link {
                font-size: 0.9rem;
                cursor: pointer;
                text-decoration: underline;
                padding: 5px 0;
            }
        }
    }
    .hidden {
        display: none !important;
    }
</style>

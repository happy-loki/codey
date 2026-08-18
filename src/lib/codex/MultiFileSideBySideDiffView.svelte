<script lang="ts">
    import MultiFileDiffView from "./MultiFileDiffView.svelte";
    import type { FileUpdateChange } from "./types";

    export let changes: FileUpdateChange[] = [];
</script>

<MultiFileDiffView
    {changes}
    tone="default"
    defaultExpanded={true}
    showStatusLabel={true}
    diffStyle="split"
    maxDiffHeight={null}
    renderer="pierre"
/>

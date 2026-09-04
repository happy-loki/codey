<script lang="ts">
    export let html = "";
    export let plain = false;
</script>

<div class="markdown-block" class:plain>{@html html}</div>

<style>
    /* Keep the keyed wrapper from changing the original Markdown layout. */
    .markdown-block {
        display: contents;
    }
</style>

<script lang="ts">
    export let size = 24;
    export let color = "currentColor";
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
>
    <!-- 中心节点 -->
    <circle cx="12" cy="12" r="3" />
    
    <!-- 右侧分支 -->
    <line x1="15" y1="12" x2="18" y2="8" />
    <circle cx="18" cy="8" r="2" />
    
    <line x1="15" y1="12" x2="18" y2="16" />
    <circle cx="18" cy="16" r="2" />
    
    <!-- 左侧分支 -->
    <line x1="9" y1="12" x2="6" y2="8" />
    <circle cx="6" cy="8" r="2" />
    
    <line x1="9" y1="12" x2="6" y2="16" />
    <circle cx="6" cy="16" r="2" />
</svg>

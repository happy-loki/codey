export function isSyncableHostBridgeTab(tab: any): boolean {
    if (!tab) return false;
    const raw = typeof tab.path === "string" ? tab.path : "";
    const path = raw.trim();
    if (!path) return false;
    if (path.startsWith("diff://")) return false;
    if (tab.isfile) return true;
    if (tab.isimage) return true;
    return false;
}

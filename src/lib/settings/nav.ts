export type NavDefinition = {
    id: number | string;
    key: string;
    children?: NavDefinition[];
};

export const NAV_DEFINITIONS: NavDefinition[] = [
    {
        id: 0,
        key: "settings.general",
        children: [
            { id: 1, key: "settings.theme" },
            { id: 100, key: "settings.language" }
        ]
    },
    {
        id: 40,
        key: "settings.network"
    },
    {
        id: 10,
        key: "settings.ui",
        children: [
            { id: 11, key: "settings.fontSize" },
            { id: 12, key: "settings.fontFamily" }
        ]
    },
    {
        id: 2,
        key: "settings.editor",
        children: [
            { id: 3, key: "settings.fontSize" },
            { id: 4, key: "settings.fontFamily" },
            { id: 5, key: "settings.lineHeight" },
            { id: 105, key: "settings.lineWrapping" }
        ]
    },
    {
        id: 6,
        key: "settings.terminal",
        children: [
            { id: 7, key: "settings.fontSize" },
            { id: 8, key: "settings.fontFamily" }
        ]
    },
    {
        id: 20,
        key: "settings.assistant",
        children: [
            { id: 21, key: "settings.fontSize" },
            { id: 22, key: "settings.fontFamily" }
        ]
    },
    {
        id: 24,
        key: "settings.systemDictationTitle",
        children: [{ id: 241, key: "settings.systemDictationMacShortcut" }]
    },
    {
        id: 30,
        key: "settings.wechat",
        children: [
            { id: 31, key: "settings.wechatCredentials" },
            { id: 32, key: "settings.wechatConnection" }
        ]
    },
    {
        id: 90,
        key: "settings.about",
        children: [{ id: 91, key: "settings.aboutOverview" }]
    }
];

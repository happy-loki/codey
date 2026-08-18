export type FontItem = {
    id: string;
    name: string;
    value?: string;
    label?: string;
};

export type WechatSettings = {
    appId: string;
    appSecret: string;
};

export type WechatConnectionState = "idle" | "success" | "error";

export type ProxyMode = "auto" | "manual" | "direct";

export type ProxySettings = {
    mode: ProxyMode;
    http: string;
    https: string;
    noProxy: string;
};

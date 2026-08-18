import { SYSTEM_MONO_FONT_STACK, SYSTEM_UI_FONT_STACK } from "../../config/fontStacks";
import type { UpdatePreferences } from "../updater";
import type { ProxySettings, WechatSettings } from "./types";
import { updatesDisabled } from "../env";

export const DEFAULT_UI_FONT_FAMILY = SYSTEM_UI_FONT_STACK;
export const DEFAULT_EDITOR_FONT_FAMILY = SYSTEM_MONO_FONT_STACK;
export const DEFAULT_TERMINAL_FONT_FAMILY = SYSTEM_MONO_FONT_STACK;
export const DEFAULT_AI_FONT_FAMILY = SYSTEM_UI_FONT_STACK;

export const DEFAULT_UPDATE_SETTINGS: UpdatePreferences = {
    autoCheck: updatesDisabled ? false : true,
    autoInstall: updatesDisabled ? false : true
};

export const DEFAULT_WECHAT_SETTINGS: WechatSettings = {
    appId: "",
    appSecret: ""
};

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
    mode: "auto",
    http: "",
    https: "",
    noProxy: ""
};

export const BUILTIN_FONT_STACKS = [
    DEFAULT_UI_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_AI_FONT_FAMILY
];

export const BUILTIN_FONT_VALUES = BUILTIN_FONT_STACKS.map(value => value.toLowerCase());

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isWindowsPlatform = /\bWindows\b/i.test(userAgent);

export const updatesDisabled = false;

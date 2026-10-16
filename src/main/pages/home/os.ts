export type DownloadOs = "windows" | "linux" | "macos" | "android" | "ios";

export const DESKTOP_OS: DownloadOs[] = ["windows", "linux", "macos"];
export const MOBILE_OS: DownloadOs[] = ["android", "ios"];

export const ALL_OS: DownloadOs[] = [
    "windows",
    "linux",
    "macos",
    "android",
    "ios",
] as const;

export interface OsInfo {
    id: DownloadOs;
    label: string;
    description: string;
    icon: string;
    maintained: boolean;
    group: "desktop" | "mobile";
}

export const OS_CONFIG: Record<DownloadOs, OsInfo> = {
    windows: {
        id: "windows",
        label: "Windows",
        description: "Установщик в формате .exe, портативная версия, поддерживается обновление",
        icon: "computer",
        maintained: true,
        group: "desktop",
    },
    linux: {
        id: "linux",
        label: "Linux",
        description: ".deb, .rpm, AppImage",
        icon: "computer",
        maintained: true,
        group: "desktop",
    },
    macos: {
        id: "macos",
        label: "macOS",
        description: "DMG для Apple Silicon и Intel",
        icon: "computer",
        maintained: true,
        group: "desktop",
    },
    android: {
        id: "android",
        label: "Android",
        description: "APK, активно поддерживается",
        icon: "android",
        maintained: true,
        group: "mobile",
    },
    ios: {
        id: "ios",
        label: "iOS",
        description: "IPA, работает только через sideload. Для опытных пользователей",
        icon: "phone_iphone",
        maintained: false,
        group: "mobile",
    },
};

export function detectOs(): DownloadOs {
    if (typeof navigator === "undefined") {
        return "android";
    }

    const ua = (navigator.userAgent || navigator.platform || "").toLowerCase();
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toLowerCase?.() ?? "";
    const haystack = `${ua} ${platform}`;

    if (haystack.includes("android")) {
        return "android";
    }

    if (haystack.includes("iphone") || haystack.includes("ipad") || haystack.includes("ipod")) {
        return "ios";
    }

    if (haystack.includes("win")) {
        return "windows";
    }

    if (haystack.includes("mac")) {
        return "macos";
    }

    if (haystack.includes("linux")) {
        return "linux";
    }

    return "windows";
}

export function getOsLabel(os: DownloadOs): string {
    return OS_CONFIG[os].label;
}

export function isDesktopOs(os: DownloadOs): boolean {
    return OS_CONFIG[os].group === "desktop";
}

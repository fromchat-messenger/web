export type DownloadOs = "windows" | "linux" | "macos" | "android" | "ios";

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
}

export const OS_CONFIG: Record<DownloadOs, OsInfo> = {
    windows: { id: "windows", label: "Windows", description: "ПК", icon: "computer" },
    linux: { id: "linux", label: "Linux", description: "ПК", icon: "computer" },
    macos: { id: "macos", label: "macOS", description: "Apple", icon: "computer" },
    android: { id: "android", label: "Android", description: "APK", icon: "android" },
    ios: { id: "ios", label: "iOS", description: "iPhone, iPad", icon: "phone_iphone" },
};

export function detectOs(): DownloadOs {
    if (typeof navigator === "undefined") {
        return "android";
    }

    const ua = (navigator.userAgent || navigator.platform || "").toLowerCase();
    const platform = (navigator as any).userAgentData?.platform?.toLowerCase?.() ?? "";
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

    return "android";
}

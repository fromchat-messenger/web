export const GITHUB_BACKEND = "https://github.com/fromchat-messenger/backend";
export const GITHUB_APP = "https://github.com/fromchat-messenger/app";
export const GITHUB_WEB = "https://github.com/fromchat-messenger/web";
export const GITHUB_DEPLOYMENT = "https://github.com/fromchat-messenger/deployment";
export const GITHUB_LICENSE = `${GITHUB_WEB}/blob/main/LICENSE`;
export const GITHUB_ORG = "https://github.com/fromchat-messenger";
export const FROMCHAT_GIT = "https://git.fromchat.ru/FromChat";
export const SUPPORT_TELEGRAM = "https://t.me/denis0001-dev";
export const KEEP_ANDROID_OPEN_URL = "https://keepandroidopen.org/ru/";
/** Same deadline as https://keepandroidopen.org/banner.js */
export const KEEP_ANDROID_OPEN_LOCKDOWN_AT = new Date("Jan 1, 2027 00:00:00").getTime();

export interface HomeNavLink {
    id: string;
    label: string;
    href: string;
    icon: string;
    external?: boolean;
}

export const HOME_NAV_LINKS: HomeNavLink[] = [
    { id: "home", label: "Главная", href: "/", icon: "home" },
    { id: "web", label: "Веб-версия", href: "/login", icon: "language" },
    { id: "desktop", label: "Для ПК", href: "/desktop", icon: "computer" },
    { id: "support", label: "Поддержка", href: SUPPORT_TELEGRAM, icon: "support_agent", external: true },
];

export const SELF_HOST_COMMANDS = `git clone https://github.com/fromchat-messenger/backend.git
cd backend
bash scripts/generate-env.sh
docker compose up --build -d`;

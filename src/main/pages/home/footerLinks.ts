import {
    FROMCHAT_GIT,
    GITHUB_APP,
    GITHUB_BACKEND,
    GITHUB_DEPLOYMENT,
    GITHUB_LICENSE,
    GITHUB_ORG,
    GITHUB_WEB,
    SUPPORT_TELEGRAM,
} from "@/pages/home/homeNav";

export type FooterIconSvg =
    | "footerLinkIconSvgTelegram"
    | "footerLinkIconSvgMax"
    | "footerLinkIconSvgGithub"
    | "footerLinkIconSvgGitea"
    | "footerLinkIconSvgApple";

export interface FooterLinkItem {
    label: string;
    href?: string;
    external?: boolean;
    icon?: string;
    iconSvg?: FooterIconSvg;
    action?: "scroll-download";
}

export interface FooterColumn {
    title: string;
    links: FooterLinkItem[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
    {
        title: "Клиенты",
        links: [
            { label: "Desktop", href: "/desktop", icon: "computer" },
            { label: "Android", action: "scroll-download", icon: "android" },
            { label: "iOS", action: "scroll-download", iconSvg: "footerLinkIconSvgApple" },
            { label: "Веб-версия", href: "/login", icon: "language" },
        ],
    },
    {
        title: "Исходный код",
        links: [
            { label: "Приложение", href: `${GITHUB_APP}/tree/main`, external: true, icon: "android" },
            { label: "Веб-клиент", href: `${GITHUB_WEB}/tree/main`, external: true, icon: "language" },
            { label: "Сервер", href: `${GITHUB_BACKEND}/tree/main`, external: true, icon: "storage" },
            {
                label: "Развертывание",
                href: `${GITHUB_DEPLOYMENT}/tree/main`,
                external: true,
                icon: "deployed_code",
            },
            { label: "FromChat Git", href: FROMCHAT_GIT, external: true, iconSvg: "footerLinkIconSvgGitea" },
            { label: "GitHub", href: GITHUB_ORG, external: true, iconSvg: "footerLinkIconSvgGithub" },
        ],
    },
    {
        title: "Правовая информация",
        links: [
            { label: "Политика конфиденциальности", href: "/privacy", icon: "shield" },
            { label: "Пользовательское соглашение", href: "/terms", icon: "description" },
            { label: "Лицензия", href: GITHUB_LICENSE, external: true, icon: "description" },
        ],
    },
    {
        title: "Сообщество",
        links: [
            {
                label: "Telegram",
                href: "https://t.me/fromchat_ch",
                external: true,
                iconSvg: "footerLinkIconSvgTelegram",
            },
            {
                label: "MAX",
                href: "https://max.ru/join/c5t6LfnCCPetQSAOshmouEvq9vsjHZT_Lt63kw8YCg0",
                external: true,
                iconSvg: "footerLinkIconSvgMax",
            },
            { label: "Поддержка", href: SUPPORT_TELEGRAM, external: true, icon: "support" },
        ],
    },
];

const GITHUB_WEB = "https://github.com/fromchat-messenger/web";
const GITHUB_APP = "https://github.com/fromchat-messenger/app";
export const GITHUB_LICENSE = `${GITHUB_WEB}/blob/main/LICENSE`;

export function GitHubLink({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <a
            href={`${GITHUB_WEB}/tree/main`}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
        >
            {children}
        </a>
    );
}

export function SupportLink({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <a
            href="https://t.me/denis0001-dev"
            target="_blank"
            rel="noopener noreferrer"
            className={className}
        >
            {children}
        </a>
    );
}

export { GITHUB_WEB, GITHUB_APP };

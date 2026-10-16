import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useUserStore } from "@/state/user";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import { HOME_NAV_LINKS } from "@/pages/home/homeNav";
import styles from "@/pages/home/home-header.module.scss";

interface HomeHeaderProps {
    onScrollToDownload?: () => void;
}

export function HomeHeader({ onScrollToDownload }: HomeHeaderProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useUserStore();
    const { isMobile } = useDownloadAppScreen();
    const [scrolled, setScrolled] = useState(false);
    const isLoggedIn = Boolean(user.authToken && user.currentUser);

    useEffect(() => {
        function onScroll() {
            setScrolled(window.scrollY > 12);
        }

        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    function handlePrimaryAction() {
        if (isMobile) {
            onScrollToDownload?.();
            return;
        }
        if (isLoggedIn) {
            navigate("/chat");
            return;
        }
        onScrollToDownload?.();
    }

    function isActiveLink(id: string): boolean {
        if (id === "home") {
            return location.pathname === "/";
        }
        if (id === "desktop") {
            return location.pathname === "/desktop";
        }
        if (id === "web") {
            return location.pathname === "/login" || location.pathname.startsWith("/auth");
        }
        return false;
    }

    const primaryLabel = isMobile
        ? "Скачать"
        : isLoggedIn
          ? "Открыть"
          : "Скачать";

    const primaryIcon = isMobile ? "download" : isLoggedIn ? "open_in_new" : "download";

    function renderNavLink(link: (typeof HOME_NAV_LINKS)[number], className: string) {
        const content = (
            <>
                <MaterialIcon name={link.icon} className={styles.navLinkIcon} />
                <span>{link.label}</span>
            </>
        );

        if (link.external) {
            return (
                <a
                    key={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                >
                    {content}
                </a>
            );
        }

        return (
            <Link key={link.id} to={link.href} className={className}>
                {content}
            </Link>
        );
    }

    return (
        <header
            className={`${styles.header}${scrolled ? ` ${styles.headerScrolled}` : ""}`}
            data-home-header
        >
            <div className={styles.headerShell}>
                <div className={styles.headerInner}>
                    <Link to="/" className={styles.logoLink}>
                        <div className={styles.logoIcon} aria-hidden />
                        <span className={styles.brandWordmark}>FromChat</span>
                    </Link>

                    <nav className={styles.nav} aria-label="Основная навигация">
                        {HOME_NAV_LINKS.map((link) => {
                            const className = [
                                styles.navLink,
                                styles[`navLink_${link.id}`],
                                isActiveLink(link.id) ? styles.navLinkActive : "",
                            ]
                                .filter(Boolean)
                                .join(" ");

                            return renderNavLink(link, className);
                        })}
                    </nav>

                    <div className={styles.headerActions}>
                        <MaterialButton
                            variant="filled"
                            onClick={handlePrimaryAction}
                            icon={primaryIcon}
                        >
                            {primaryLabel}
                        </MaterialButton>
                    </div>
                </div>
            </div>
        </header>
    );
}

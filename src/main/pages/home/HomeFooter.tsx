import { Link } from "react-router-dom";
import { MaterialIcon } from "@/utils/material";
import {
    FOOTER_COLUMNS,
    type FooterLinkItem,
} from "@/pages/home/footerLinks";
import styles from "@/pages/home/home-footer.module.scss";

interface HomeFooterProps {
    onScrollToDownload?: () => void;
}

function FooterLink({ item, onScrollToDownload }: { item: FooterLinkItem; onScrollToDownload?: () => void }) {
    const icon = item.iconSvg ? (
        <span
            className={`${styles.footerLinkIcon} ${styles.footerLinkIconSvg} ${styles[item.iconSvg]}`}
        />
    ) : item.icon ? (
        <MaterialIcon name={item.icon} className={styles.footerLinkIcon} />
    ) : null;

    if (item.action === "scroll-download") {
        return (
            <button type="button" className={styles.footerLink} onClick={onScrollToDownload}>
                {icon}
                {item.label}
            </button>
        );
    }

    if (item.external) {
        return (
            <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
            >
                {icon}
                {item.label}
            </a>
        );
    }

    return (
        <Link to={item.href!} className={styles.footerLink}>
            {icon}
            {item.label}
        </Link>
    );
}

export function HomeFooter({ onScrollToDownload }: HomeFooterProps) {
    return (
        <footer className={styles.homepageFooter}>
            <div className={styles.footerInner}>
                <div className={styles.footerBrand}>
                    <div className={styles.footerLogoRow}>
                        <div className={styles.footerLogo} aria-hidden />
                        <span className={styles.footerBrandName}>FromChat</span>
                    </div>
                    <p className={styles.footerCopyright}>
                        <span>FromChat</span>
                        <span className={styles.footerCopyrightSymbol} aria-hidden="true">
                            ©
                        </span>
                        <span>2026</span>
                    </p>
                </div>

                <div className={styles.footerGrid}>
                    {FOOTER_COLUMNS.map((column) => (
                        <div key={column.title} className={styles.footerColumn}>
                            <h3 className={styles.footerColumnTitle}>{column.title}</h3>
                            <ul className={styles.footerColumnList}>
                                {column.links.map((item) => (
                                    <li key={item.label}>
                                        <FooterLink item={item} onScrollToDownload={onScrollToDownload} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </footer>
    );
}

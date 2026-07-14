import { useState, useEffect, useRef } from "react";
import styles from "./css/searchBar.module.scss";
import { MaterialIcon, type MDUIBottomAppBar } from "@/utils/material";

interface SearchBarProps {
    placeholder: string;
    children?: React.ReactNode;
    searchQuery: string;
    onQueryChange: (query: string) => void;
    isExpanded: boolean;
    onToggleExpanded: () => void;
    leftIcon?: string | React.ReactNode;
    rightIcon?: string | React.ReactNode;
    containerRef: React.RefObject<HTMLElement | null>;
    headerRef?: React.RefObject<HTMLElement | null>;
    bottomAppBarRef?: React.RefObject<MDUIBottomAppBar | null>;
}

export default function SearchBar({
    placeholder,
    children,
    searchQuery,
    onQueryChange,
    isExpanded,
    onToggleExpanded,
    leftIcon = "search--outlined",
    rightIcon = null,
    containerRef,
    headerRef,
    bottomAppBarRef
}: SearchBarProps) {
    const [dynamicHeight, setDynamicHeight] = useState<string>("48px");
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const searchContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const parentContainerRef = useRef<HTMLDivElement>(null);


    // Focus input when expanded and manage height
    useEffect(() => {
        if (isExpanded && inputRef.current) {
            inputRef.current.focus();
            // Set expanded height, subtracting both header and bottom app bar heights
            if (containerRef.current) {
                const panelHeight = containerRef.current.offsetHeight;
                let headerHeight = 0;
                let bottomBarHeight = 0;
                
                // Get header height
                if (headerRef?.current) {
                    headerHeight = headerRef.current.offsetHeight;
                }
                
                // Get bottom app bar height
                if (bottomAppBarRef?.current) {
                    bottomBarHeight = bottomAppBarRef.current.offsetHeight;
                }
                
                // Calculate height by subtracting both header and bottom bar heights
                const availableHeight = panelHeight - headerHeight - bottomBarHeight;
                setDynamicHeight(`${availableHeight}px`);
            }
        } else {
            // Set collapsed height
            setDynamicHeight("48px");
        }
        
        // Show/hide results and disable overflow during transition
        if (isExpanded) {
            setShowResults(true);
        }
        
        setIsTransitioning(true);
        const timeout = setTimeout(() => {
            setIsTransitioning(false);
            if (!isExpanded) {
                setShowResults(false);
            }
        }, 400); // Match transition duration (0.4s)
        
        return () => clearTimeout(timeout);
    }, [isExpanded, containerRef, headerRef, bottomAppBarRef]);

    function handleToggle() {
        onToggleExpanded();
    };

    function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
        const query = e.target.value;
        onQueryChange(query);
    };

    // Helper function to render icon
    function renderIcon(icon: string | React.ReactNode | undefined, defaultIcon?: string) {
        if (icon === null) return null;
        if (!icon) {
            return defaultIcon ? <MaterialIcon name={defaultIcon} /> : null;
        } else if (typeof icon === 'string') {
            return <MaterialIcon name={icon} />;
        } else {
            return icon;
        }
    };

    return (
        <div
            ref={parentContainerRef}
            className={styles.searchParent}
        >
            <div
                ref={searchContainerRef}
                className={`${styles.searchBarContainer} ${isExpanded ? styles.expanded : styles.collapsed}`}
                style={{ height: dynamicHeight }}
                onClick={!isExpanded ? handleToggle : undefined}
            >
                {/* Single Search Bar Element */}
                <div className={styles.searchBar}>
                    {/* Left Icon */}
                    <div className={styles.searchIcon}>
                        {renderIcon(leftIcon, "search--outlined")}
                    </div>

                    {/* Input/Placeholder */}
                    <div className={styles.searchInputContainer}>
                        {isExpanded ? (
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder={placeholder}
                                className={styles.searchInput}
                                value={searchQuery}
                                onChange={handleQueryChange}
                                onClick={(e) => e.stopPropagation()}
                            />
                        ) : (
                            <span className={styles.searchPlaceholder}>{placeholder}</span>
                        )}
                    </div>

                    {/* Right Icon */}
                    <div className={styles.searchClear}>
                        {renderIcon(rightIcon)}
                    </div>
                </div>

                {/* Results Section - Visible during expansion and collapse transition */}
                {showResults && (
                    <div 
                        className={styles.searchResults}
                        style={{ overflowY: isTransitioning ? "hidden" : "auto" }}
                    >
                        {children}
                    </div>
                )}
            </div>
        </div>
    );
}
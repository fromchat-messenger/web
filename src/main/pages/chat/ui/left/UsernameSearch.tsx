import { useState, useEffect, useRef } from "react";
import { useUserStore } from "@/state/user";
import { useChatStore } from "@/state/chat";
import api from "@/core/api";
import { StatusBadge } from "@/core/components/StatusBadge";
import type { User } from "@/core/types";
import { onlineStatusManager } from "@/core/onlineStatusManager";
import { OnlineIndicator } from "@/pages/chat/ui/right/OnlineIndicator";
import { OnlineStatus } from "@/pages/chat/ui/right/OnlineStatus";
import defaultAvatar from "@/images/default-avatar.png";
import SearchBar from "@/core/components/SearchBar";
import { MaterialCircularProgress, MaterialIconButton, MaterialList, MaterialListItem, type MDUIBottomAppBar } from "@/utils/material";
import styles from "@/pages/chat/css/left-panel.module.scss";

interface SearchUser extends User {
    publicKey?: string | null;
    verified?: boolean;
}

export interface UsernameSearchProps {
    containerRef: React.RefObject<HTMLElement | null>;
    headerRef?: React.RefObject<HTMLElement | null>;
    bottomAppBarRef?: React.RefObject<MDUIBottomAppBar | null>;
}

export function UsernameSearch({ containerRef, headerRef, bottomAppBarRef }: UsernameSearchProps) {
    const { user } = useUserStore();
    const { switchToDM, activeDm } = useChatStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);
    const switchingToUserIdRef = useRef<number | null>(null);
    const previousSearchResultIdsRef = useRef<Set<number>>(new Set());

    // Debounced search
    useEffect(() => {
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }

        if (searchQuery.length > 1) {
            setIsSearching(true);
            const newTimeout = setTimeout(async () => {
                if (user.authToken) {
                    try {
                        const users = await api.user.search.searchUsers(searchQuery, user.authToken);
                        setSearchResults(users);
                    } catch (error) {
                        console.error("Search failed:", error);
                        setSearchResults([]);
                    } finally {
                        setIsSearching(false);
                    }
                }
            }, 300);
            setDebounceTimeout(newTimeout);
        } else {
            setSearchResults([]);
            setIsSearching(false);
        }

        return () => {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
        };
    }, [searchQuery, user.authToken]);

    // Subscribe to online status for all search results
    useEffect(() => {
        const activeDmUserId = activeDm?.userId;
        const switchingToUserId = switchingToUserIdRef.current;
        const currentSearchResultIds = new Set(searchResults.map(u => u.id));
        const previousSearchResultIds = new Set(previousSearchResultIdsRef.current);
        
        // Unsubscribe from users that were in previous results but not in current results
        // (unless they're the active DM or we're switching to them)
        previousSearchResultIds.forEach(userId => {
            if (!currentSearchResultIds.has(userId) && 
                userId !== activeDmUserId && 
                userId !== switchingToUserId) {
                onlineStatusManager.unsubscribe(userId);
            }
        });

        // Subscribe to all current search results
        searchResults.forEach(searchUser => {
            onlineStatusManager.subscribe(searchUser.id);
        });

        // Update previous results for next effect run
        previousSearchResultIdsRef.current = currentSearchResultIds;

        // Cleanup function - don't unsubscribe here as normal transitions are handled in effect body
        // This only runs when component unmounts or when transitioning to empty results
        return () => {
            // Note: Normal search result transitions are handled above in the effect body
            // by comparing previous vs current. This cleanup only runs when the component
            // unmounts or when the dependency changes, but we've already handled
            // unsubscription in the effect body above, so this is mostly a no-op for normal transitions.
            
            // Clear the ref if the user is now the active DM (state has updated)
            const finalSwitchingToUserId = switchingToUserIdRef.current;
            const finalActiveDmUserId = activeDm?.userId;
            if (finalSwitchingToUserId && finalSwitchingToUserId === finalActiveDmUserId) {
                switchingToUserIdRef.current = null;
            }
        };
    }, [searchResults, activeDm?.userId]);


    async function handleUserClick(searchUser: SearchUser) {
        if (!user.authToken) return;

        try {

            let publicKey = searchUser.publicKey;
            if (!publicKey) {
                const fetchedPublicKey = await api.chats.dm.fetchUserPublicKey(searchUser.id, user.authToken);
                publicKey = fetchedPublicKey;
            }

            if (publicKey) {
                // Store the userId we're switching to so cleanup doesn't unsubscribe
                switchingToUserIdRef.current = searchUser.id;
                switchToDM({
                    userId: searchUser.id,
                    username: searchUser.username,
                    publicKey: publicKey,
                    profilePicture: searchUser.profile_picture,
                    online: searchUser.online || false
                });
                // Collapse search
                setIsExpanded(false);
                setSearchQuery("");
                setSearchResults([]);
            }
        } catch (error) {
            console.error("Failed to start DM conversation:", error);
        }
    }

    function handleQueryChange(query: string) {
        setSearchQuery(query);
    }

    function handleToggleExpanded() {
        if (isExpanded) {
            // Collapsing
            setSearchQuery("");
            setSearchResults([]);
        }
        setIsExpanded(!isExpanded);
    }

    return (
        <SearchBar
            placeholder="Поиск"
            searchQuery={searchQuery}
            onQueryChange={handleQueryChange}
            isExpanded={isExpanded}
            onToggleExpanded={handleToggleExpanded}
            leftIcon={isExpanded ? (
                <MaterialIconButton
                    className="back-button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpanded();
                    }}
                    type="button"
                    icon="arrow_back--outlined"
                />
            ) : "search--outlined"}
            containerRef={containerRef}
            headerRef={headerRef}
            bottomAppBarRef={bottomAppBarRef}
        >
            {isSearching && (
                <div className={styles.searchLoading}>
                    <MaterialCircularProgress />
                    <span>Поиск...</span>
                </div>
            )}

            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                <div className={styles.searchEmpty}>
                    <span>Пользователи не найдены</span>
                </div>
            )}

            {!isSearching && searchResults.length > 0 && (
                <MaterialList>
                    {searchResults.map((searchUser) => (
                        <MaterialListItem
                            key={searchUser.id}
                            headline={searchUser.username}
                            onClick={() => handleUserClick(searchUser)}
                            style={{ cursor: "pointer" }}
                        >
                            <div slot="custom" className={styles.searchResultContainer}>
                                <div className={styles.searchResult}>
                                    <div className={styles.searchResultIcon}>
                                        <img
                                            src={searchUser.profile_picture || defaultAvatar}
                                            alt={searchUser.username}
                                            className={styles.searchResultIconImg}
                                            onError={(e) => {
                                                e.target.src = defaultAvatar;
                                            }}
                                        />
                                        <OnlineIndicator userId={searchUser.id} />
                                    </div>
                                    <div className={styles.searchResultBody}>
                                        <div className={styles.searchResultHeadline}>
                                            {searchUser.username}
                                            <StatusBadge
                                                verificationStatus={searchUser.verification_status}
                                                verified={searchUser.verified || false}
                                                size="small"
                                            />
                                        </div>
                                        <div className={styles.searchResultDescription}>
                                            <OnlineStatus userId={searchUser.id} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </MaterialListItem>
                    ))}
                </MaterialList>
            )}

            {!isSearching && searchQuery.length < 2 && (
                <div className={styles.searchHint}>
                    <span>Введите минимум 2 символа для поиска</span>
                </div>
            )}
        </SearchBar>
    );
}
/* Minimal JS for filtering messages in the static report. */

function normalizeText(s) {
    return (s || "").toString().toLowerCase();
}

function filterReport(query) {
    const q = normalizeText(query).trim();
    const conversations = document.querySelectorAll(".conversation");
    let anyVisible = false;

    conversations.forEach((conv) => {
        const rows = conv.querySelectorAll("[data-search]");
        let visibleInConv = 0;

        rows.forEach((row) => {
            const hay = normalizeText(row.getAttribute("data-search"));
            const match = !q || hay.includes(q);
            row.classList.toggle("hidden", !match);
            if (match) visibleInConv += 1;
        });

        const convMatch = visibleInConv > 0;
        conv.classList.toggle("hidden", !convMatch);
        if (convMatch) anyVisible = true;
    });

    const hint = document.getElementById("filterHint");
    if (hint) {
        hint.textContent = q
            ? (anyVisible ? "Filtered" : "No matches")
            : "Type to filter by text, user id, filename";
    }
}

function setupEditHistoryTabs() {
    document.querySelectorAll(".edit-tabs-vertical").forEach((tabsContainer) => {
        const tabs = tabsContainer.querySelectorAll(".tab-vertical");

        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                const version = tab.getAttribute("data-version");
                const messageId = tab.getAttribute("data-message-id");

                // Find the corresponding message container
                const messageContainer = document.querySelector(`.message-container:has([data-message-id="${messageId}"])`);
                if (!messageContainer) return;

                // Update tab states within this message
                const allTabs = messageContainer.querySelectorAll(".tab-vertical");
                allTabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                // Update bubble states within this message
                const allBubbles = messageContainer.querySelectorAll(".bubble");
                allBubbles.forEach(bubble => {
                    bubble.classList.toggle("active", bubble.getAttribute("data-version") === version);
                });
            });
        });
    });
}

function convertTimestampsToLocal() {
    // Convert all timestamps to local timezone
    document.querySelectorAll("[data-timestamp]").forEach((element) => {
        const timestamp = element.getAttribute("data-timestamp");
        if (!timestamp) return;

        try {
            // Parse the ISO timestamp
            const date = new Date(timestamp.replace(" ", "T").replace("Z", "+00:00"));

            // Format in local timezone
            const localTime = date.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            // Update the displayed text
            element.textContent = localTime;
        } catch (e) {
            // If parsing fails, leave the original text
            console.warn("Failed to parse timestamp:", timestamp);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("searchInput");
    if (input) {
        input.addEventListener("input", (e) => {
            filterReport(e.target.value);
        });
    }

    // Initialize edit history tabs
    setupEditHistoryTabs();

    // Convert timestamps to local timezone
    convertTimestampsToLocal();
});


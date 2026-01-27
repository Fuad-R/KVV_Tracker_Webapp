let stopName = "";
let stopId = null;
let debugMode = false;
let debugPassword = localStorage.getItem("debugPassword") || "";
let countdown = 30;
let countdownInterval;
let refreshInterval;
let updatesPaused = false;
let lastDepartures = [];
let map = null;
let markersLayer = null;
let userMarker = null;
let searchTimeout = null;
const FAVORITES_KEY = 'kvv_favorites';
const HOME_STATION_KEY = 'kvv_home_station';

// ------------------ SEARCH (BY NAME) ------------------

// ------------------ DEBUG FUNCTIONS ------------------

function closeDebugLogin() {
    document.getElementById("debugLoginPopup").style.display = "none";
    document.getElementById("debugLoginError").style.display = "none";
}

async function loginDebug() {
    const password = document.getElementById("debugPassword").value;
    try {
        const res = await fetch("/debug/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
    if (data.success) {
        debugMode = true;
        debugPassword = password;
        localStorage.setItem("debugPassword", password);
        closeDebugLogin();
        const updateBtn = document.getElementById("updateNowBtn");
        if (updateBtn) updateBtn.style.display = "block";
        const pauseBtn = document.getElementById("pauseUpdatesBtn");
        if (pauseBtn) pauseBtn.style.display = "block";
        const leaveBtn = document.getElementById("leaveDebugBtn");
        if (leaveBtn) leaveBtn.style.display = "block";
        const mapBtn = document.getElementById("mapTabBtn");
        if (mapBtn) mapBtn.style.display = "block";
        applyFilter(); // Re-render to show edit buttons
    } else {
            document.getElementById("debugLoginError").textContent = data.error;
            document.getElementById("debugLoginError").style.display = "block";
        }
    } catch (e) {
        console.error(e);
    }
}

function logoutDebug() {
    debugMode = false;
    debugPassword = "";
    localStorage.removeItem("debugPassword");
    
    // Hide debug buttons
    const updateBtn = document.getElementById("updateNowBtn");
    if (updateBtn) updateBtn.style.display = "none";
    const pauseBtn = document.getElementById("pauseUpdatesBtn");
    if (pauseBtn) pauseBtn.style.display = "none";
    const leaveBtn = document.getElementById("leaveDebugBtn");
    if (leaveBtn) leaveBtn.style.display = "none";
    const mapBtn = document.getElementById("mapTabBtn");
    if (mapBtn) mapBtn.style.display = "none";
    
    // If updates were paused, resume them
    if (updatesPaused) {
        togglePauseUpdates();
    }

    // Switch to departures tab if currently on map tab
    if (document.getElementById("mapTab").classList.contains("active")) {
        switchTab('departures');
    }
    
    // Re-render departures to remove edit buttons
    applyFilter();
}

function openDebugEdit(stop_id, line, direction, stable_scheduled_time, minutes, delay) {
    document.getElementById("editStopId").value = stop_id;
    document.getElementById("editLine").value = line;
    document.getElementById("editDirection").value = direction;
    document.getElementById("editStableScheduledTime").value = stable_scheduled_time;
    document.getElementById("editMinutes").value = minutes;
    document.getElementById("editDelay").value = delay || 0;
    document.getElementById("debugEditPopup").style.display = "block";
}

function closeDebugEdit() {
    document.getElementById("debugEditPopup").style.display = "none";
}

async function saveDebugOverride() {
    const stop_id = document.getElementById("editStopId").value;
    const line = document.getElementById("editLine").value;
    const direction = document.getElementById("editDirection").value;
    const stable_scheduled_time = document.getElementById("editStableScheduledTime").value;
    const minutes = document.getElementById("editMinutes").value;
    const delay = document.getElementById("editDelay").value;

    try {
        const res = await fetch("/debug/update", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Debug-Password": debugPassword
            },
            body: JSON.stringify({
                stop_id,
                line,
                direction,
                stable_scheduled_time,
                minutes_remaining: minutes,
                delay: delay
            })
        });
        const result = await res.json();
        console.log("Debug update response:", result);
        closeDebugEdit();
        refreshDepartures(); // Refresh data to see changes
    } catch (e) {
        console.error(e);
    }
}

async function clearDebugOverride() {
    const stop_id = document.getElementById("editStopId").value;
    const line = document.getElementById("editLine").value;
    const direction = document.getElementById("editDirection").value;
    const stable_scheduled_time = document.getElementById("editStableScheduledTime").value;

    try {
        const res = await fetch("/debug/update", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Debug-Password": debugPassword
            },
            body: JSON.stringify({
                stop_id,
                line,
                direction,
                stable_scheduled_time
                // No overrides provided means clear
            })
        });
        const data = await res.json();
        console.log("Debug clear response:", data);
        closeDebugEdit();
        refreshDepartures();
    } catch (e) {
        console.error(e);
    }
}

// ------------------ SEARCH (BY NAME) ------------------

function searchStop() {
    stopId = null; // reset ID-based search

    let inputName = document.getElementById("stopInput").value.trim();
    if (!inputName) return;

    if (inputName === "test-dev-debug") {
        document.getElementById("debugLoginPopup").style.display = "block";
        document.getElementById("stopInput").value = "";
        return;
    }

    // Strip secondary info after '/' for lookup
    if (inputName.includes('/')) {
        inputName = inputName.split('/')[0].trim();
    }
    stopName = inputName;

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("wheelchairFilter").checked = false;

    fetchDepartures(false, true);

    if (refreshInterval) clearInterval(refreshInterval);
    if (countdownInterval) clearInterval(countdownInterval);

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(() => refreshDepartures(false), 30000);
}

// ------------------ QUICK SEARCH (BY NAME) ------------------

function quickSearch(station) {
    document.getElementById("stopInput").value = station;
    toggleClearButton();
    searchStop();
}

// ------------------ QUICK SEARCH (BY ID) ------------------

function quickSearchById(id, displayName) {
    stopId = id;
    stopName = displayName;

    document.getElementById("stopInput").value = displayName;
    toggleClearButton();
    document.getElementById("stationHeader").innerText = displayName;

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("wheelchairFilter").checked = false;

    fetchDeparturesById(false, true);

    if (refreshInterval) clearInterval(refreshInterval);
    if (countdownInterval) clearInterval(countdownInterval);

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(() => refreshDepartures(false), 30000);
}

// ------------------ COUNTDOWN ------------------

function refreshDepartures(ignorePaused = true) {
    if (stopId) {
        fetchDeparturesById(ignorePaused);
    } else if (stopName) {
        fetchDepartures(ignorePaused);
    }
}

function updateCountdown() {
    if (updatesPaused) {
        document.getElementById("countdown").innerText = "Paused";
        return;
    }
    const minutes = Math.floor(countdown / 60) || 0;
    const seconds = countdown % 60;
    document.getElementById("countdown").innerText = `${seconds}s`;
    countdown--;
    if (countdown < 0) countdown = 30;
}

function togglePauseUpdates() {
    updatesPaused = !updatesPaused;
    const btn = document.getElementById("pauseUpdatesBtn");
    if (btn) {
        btn.innerText = updatesPaused ? "Resume Updates" : "Pause Updates";
    }
    if (!updatesPaused) {
        countdown = 30;
        refreshDepartures();
    }
    updateCountdown();
}

function updateNow() {
    countdown = 30;
    refreshDepartures(true);
}

// ------------------ FETCH (BY NAME) ------------------

async function fetchDepartures(ignorePaused = false, isUserSearch = false) {
    if (updatesPaused && !ignorePaused) return;
    document.getElementById("loading").style.display = "block";
    closeError();
    
    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }

    if (isUserSearch) {
        searchTimeout = setTimeout(() => {
            showError("Station not found, try again.");
        }, 10000);
        // Clear the grid so we don't see old departures if a search fails
        document.getElementById("departuresGrid").innerHTML = "";
    }

    try {
        // Use a refined name for the search lookup
        let lookupName = stopName;
        if (lookupName.includes('/')) {
            lookupName = lookupName.split('/')[0].trim();
        }

        const res = await fetch(`/search?stop=${encodeURIComponent(lookupName)}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        if (searchTimeout) {
            clearTimeout(searchTimeout);
            searchTimeout = null;
        }

        const fullStationName = result.station_name;

        // Store the full station name and ID from API
        stopName = fullStationName;
        document.getElementById("stopInput").value = fullStationName;
        toggleClearButton();
        if (result.departures.length > 0) {
            stopId = result.departures[0].stop_id;
        }

        // Handle multiple stations
        if (result.all_stations) {
            populateStationDropdown(result.all_stations);
        } else {
            document.getElementById("stationDropdown").style.display = "none";
        }

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
        updateFavoriteButton();
        updateHomeButton();
    } catch (e) {
        console.error(e);
    } finally {
        document.getElementById("loading").style.display = "none";
    }
}

// ------------------ FETCH (BY ID) ------------------

async function fetchDeparturesById(ignorePaused = false, isUserSearch = false) {
    if (updatesPaused && !ignorePaused) return;
    document.getElementById("loading").style.display = "block";
    closeError();

    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }

    if (isUserSearch) {
        searchTimeout = setTimeout(() => {
            showError("Station not found, try again.");
        }, 10000);
        // Clear the grid so we don't see old departures if a search fails
        document.getElementById("departuresGrid").innerHTML = "";
    }

    try {
        const res = await fetch(`/search_by_id?stop_id=${stopId}&station_name=${encodeURIComponent(stopName)}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        if (searchTimeout) {
            clearTimeout(searchTimeout);
            searchTimeout = null;
        }

        document.getElementById("stationHeader").innerText =
            result.station_name;

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
        updateFavoriteButton();
        updateHomeButton();
    } catch (e) {
        console.error(e);
    } finally {
        document.getElementById("loading").style.display = "none";
    }
}

// ------------------ LINE ICON ------------------

function getLineIcon(line) {
    const lineLower = line.toLowerCase();
    const lineNumber = parseInt(line);

    if (lineLower.startsWith("s")) {
        return `<img src="/static/icons/sbahn.png" class="line-icon">`;
    } else if (!isNaN(lineNumber) && lineNumber >= 1 && lineNumber <= 9) {
        // Trams
        return `<img src="/static/icons/tram.png" class="line-icon">`;
    } else if (lineLower.startsWith("u")) {
        // UBahn
        return `<img src="/static/icons/ubahn.png" class="line-icon">`;
    } else if (lineLower.startsWith("n")) {
        // Nightline
        return `<img src="/static/icons/nl.png" class="line-icon">`;
    } else if (
        lineLower.startsWith("ic") ||
        lineLower.startsWith("re") ||
        lineLower.startsWith("rb") ||
        lineLower.startsWith("mex") ||
        lineLower.startsWith("ice") ||
        lineLower.startsWith("ir") ||
        lineLower.startsWith("ec") ||
        lineLower.startsWith("en")
    ) {
        // TrainDB
        return `<img src="/static/icons/db.png" class="line-icon">`;
    } else if (!isNaN(lineNumber) && lineNumber >= 10) {
        // Buses
        return `<img src="/static/icons/bus.png" class="line-icon">`;
    }
    return "";
}

// ------------------ FILTERING ------------------

function applyFilter() {
    const lineFilter = document.getElementById("lineFilter").value.trim();
    const typeFilter = document.getElementById("typeFilter").value;
    const wheelchairFilter = document.getElementById("wheelchairFilter").checked;

    const filtered = lastDepartures.filter(d => {
        let lineMatch = true;
        let typeMatch = true;
        let wheelchairMatch = true;

        // Line filter
        if (lineFilter) {
            if (d.line.toLowerCase().startsWith("s")) {
                lineMatch = d.line.toLowerCase() === lineFilter.toLowerCase();
            } else {
                lineMatch = parseInt(d.line) === parseInt(lineFilter);
            }
        }

        // Type filter
        if (typeFilter) {
            const isSbahn = d.line.toLowerCase().startsWith("s");
            const lineNumber = parseInt(d.line);

            if (typeFilter === "s") typeMatch = isSbahn;
            else if (typeFilter === "tram")
                typeMatch = !isSbahn && lineNumber >= 1 && lineNumber <= 9;
            else if (typeFilter === "bus")
                typeMatch = !isSbahn && lineNumber >= 10;
        }

        // Wheelchair filter
        if (wheelchairFilter) {
            wheelchairMatch = d.wheelchair_accessible === true;
        }

        return lineMatch && typeMatch && wheelchairMatch;
    });

    populateTable(filtered);
}

// ------------------ TABLE ------------------

function populateTable(data) {
    const grid = document.getElementById("departuresGrid");
    grid.innerHTML = "";

    if (data.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">No departures found</div>';
        return;
    }

    // Group by platform
    const platforms = {};
    data.forEach(d => {
        if (!platforms[d.platform]) {
            platforms[d.platform] = [];
        }
        platforms[d.platform].push(d);
    });

    // Sort platforms numerically/alphabetically
    const sortedPlatforms = Object.keys(platforms).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b);
    });

    // Create column for each platform
    sortedPlatforms.forEach(platform => {
        const platformColumn = document.createElement("div");
        platformColumn.className = "platform-column";

        // Get unique service types for this platform
        const serviceTypes = new Set();
        platforms[platform].forEach(d => {
            const type = getServiceType(d.line);
            serviceTypes.add(type);
        });

        // Create platform header with icons
        const platformHeader = document.createElement("div");
        platformHeader.className = "platform-header-title";

        const platformTitleDiv = document.createElement("div");
        platformTitleDiv.className = "platform-title-with-icons";

        const titleSpan = document.createElement("span");
        titleSpan.innerText = `Platform ${platform}`;
        platformTitleDiv.appendChild(titleSpan);

        const iconsDiv = document.createElement("div");
        iconsDiv.className = "platform-service-icons";

        // Add icons for each service type
        Array.from(serviceTypes).forEach(type => {
            const iconImg = document.createElement("img");
            iconImg.src = `/static/icons/${type}.png`;
            iconImg.className = "platform-service-icon";
            iconImg.title = type.charAt(0).toUpperCase() + type.slice(1);
            iconsDiv.appendChild(iconImg);
        });

        platformTitleDiv.appendChild(iconsDiv);
        platformHeader.appendChild(platformTitleDiv);
        platformColumn.appendChild(platformHeader);

        // Sort departures by time within platform
        platforms[platform]
            .sort((a, b) => a.minutes_remaining - b.minutes_remaining)
            .forEach(d => {
                const card = document.createElement("div");
                card.className = "departure-card";
                card.style.borderLeftColor = d.status_color || d.color;

                const iconHtml = getLineIcon(d.line);
                const realtimeBadge = d.is_realtime
                    ? '<div class="realtime-badge">Real-time</div>'
                    : '';

                // Display "Arriving now" for 0-1 minutes
                const departureDisplay = d.minutes_remaining <= 1
                    ? 'Arriving now'
                    : d.departure_display;

                let timeHtml = `<div class="departure-time">${departureDisplay}</div>`;
                if (d.delay > 1) {
                    const scheduledDisplay = d.minutes_remaining - d.delay <= 1 
                        ? 'Arriving now' 
                        : d.scheduled_display;
                    timeHtml = `
                        <div class="departure-time">
                            <span class="scheduled-time-strikethrough">${scheduledDisplay}</span>
                            <span class="estimated-time-delayed">${departureDisplay}</span>
                        </div>
                    `;
                }

                const delayInfo = d.delay > 0 
                    ? `<div class="delay-info" style="color: red; font-size: 12px; font-weight: 600;">+${d.delay}<span class="unit">min</span> delay</div>`
                    : '';

                const wheelchairIcon = d.wheelchair_accessible === true || d.wheelchair_accessible === "true"
                    ? '<span class="departure-wheelchair-icon">♿</span>'
                    : '';

                const debugEditBtn = debugMode
                    ? `<button class="debug-edit-btn" onclick="event.stopPropagation(); openDebugEdit('${d.stop_id}', '${d.line}', '${d.direction}', '${d.stable_scheduled_time}', ${d.minutes_remaining}, ${d.delay || 0})">✎</button>`
                    : '';

                card.innerHTML = `
                    <div class="line-info">
                        <div class="line-icon">${iconHtml}</div>
                        <div style="flex-grow: 1;">
                            <div class="line-number" style="color: ${d.color};">${d.line}${wheelchairIcon}${debugEditBtn}</div>
                            <div class="direction">${d.direction}</div>
                        </div>
                    </div>
                    <div class="time-section">
                        <div class="departure-time-container">
                            ${timeHtml}
                            ${delayInfo}
                        </div>
                        ${realtimeBadge}
                    </div>
                `;

                card.onclick = () => showFuture(d.line, d.direction);
                platformColumn.appendChild(card);
            });

        grid.appendChild(platformColumn);
    });
}

// Helper function to determine service type
function getServiceType(line) {
    const lineLower = line.toLowerCase();
    const lineNumber = parseInt(line);

    if (lineLower.startsWith("s")) {
        return "sbahn";
    } else if (lineLower.startsWith("u")) {
        return "ubahn";
    } else if (!isNaN(lineNumber) && lineNumber >= 1 && lineNumber <= 9) {
        return "tram";
    } else if (lineLower.startsWith("n")) {
        return "nl";
    } else if (
        lineLower.startsWith("ic") ||
        lineLower.startsWith("re") ||
        lineLower.startsWith("rb") ||
        lineLower.startsWith("mex") ||
        lineLower.startsWith("ice") ||
        lineLower.startsWith("ir") ||
        lineLower.startsWith("ec") ||
        lineLower.startsWith("en")
    ) {
        return "db";
    } else if (!isNaN(lineNumber) && lineNumber >= 10) {
        return "bus";
    }
    return "bus";
}

// ------------------ FUTURE POPUP ------------------

async function showFuture(line, direction) {
    try {
        let lookupName = stopName;
        if (lookupName.includes('/')) {
            lookupName = lookupName.split('/')[0].trim();
        }

        const res = await fetch(
            `/future_departures?stop=${encodeURIComponent(lookupName)}&line=${line}&direction=${direction}`
        );
        const data = await res.json();

        // Check accessibility from first departure (all on same line/direction should be similar)
        const isAccessible = data.length > 0 && (data[0].wheelchair_accessible === true || data[0].wheelchair_accessible === "true");
        const wheelchairIcon = isAccessible ? '<span class="future-wheelchair-icon">♿</span>' : '';

        document.getElementById("popupHeader").innerHTML = `Line ${line} towards ${direction}${wheelchairIcon}`;

        const futureList = document.getElementById("futureList");
        futureList.innerHTML = "";

        data.forEach(d => {
            const item = document.createElement("div");
            item.className = "future-item";

            const realtimeText = d.is_realtime ? 'Real-time' : 'Scheduled';

            // Display "Arriving now" for 0-1 minutes
            const departureDisplay = d.minutes_remaining <= 1
                ? 'Arriving now'
                : d.departure_display;

            let timeHtml = `<div class="future-time">${departureDisplay}</div>`;
            if (d.delay > 1) {
                const scheduledDisplay = d.minutes_remaining - d.delay <= 1 
                    ? 'Arriving now' 
                    : d.scheduled_display;
                timeHtml = `
                    <div class="future-time">
                        <span class="scheduled-time-strikethrough" style="font-size: 14px;">${scheduledDisplay}</span>
                        <span class="estimated-time-delayed" style="font-size: 18px;">${departureDisplay}</span>
                    </div>
                `;
            }

            const debugEditBtn = debugMode
                ? `<button class="debug-edit-btn" onclick="event.stopPropagation(); openDebugEdit('${d.stop_id}', '${d.line}', '${d.direction}', '${d.stable_scheduled_time}', ${d.minutes_remaining}, ${d.delay || 0})">✎</button>`
                : '';

            item.innerHTML = `
                <div style="border-left: 4px solid ${d.status_color || '#2e7d32'}; padding-left: 12px; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="flex-grow: 1;">
                        ${timeHtml}
                        <div class="future-platform">Platform ${d.platform}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="future-realtime">${realtimeText}</div>
                        ${debugEditBtn}
                    </div>
                </div>
            `;
            futureList.appendChild(item);
        });

        document.getElementById("popup").style.display = "block";
    } catch (e) {
        console.error(e);
    }
}

// ------------------ CLOSE POPUP ------------------

function closePopup() {
    document.getElementById("popup").style.display = "none";
}

function showError(message) {
    const errorBox = document.getElementById("errorBox");
    const errorMessage = document.getElementById("errorMessage");
    if (errorBox && errorMessage) {
        errorMessage.innerText = message;
        errorBox.style.display = "block";
    }
}

function closeError() {
    const errorBox = document.getElementById("errorBox");
    if (errorBox) {
        errorBox.style.display = "none";
    }
}

// ------------------ CLICK OUTSIDE POPUP ------------------

window.addEventListener("click", function(event) {
    const popup = document.getElementById("popup");
    const stationPopup = document.getElementById("stationSelectPopup");

    if (popup.style.display === "block" &&
        !popup.querySelector(".modal-content").contains(event.target)) {
        popup.style.display = "none";
    }

    const debugLoginPopup = document.getElementById("debugLoginPopup");
    if (debugLoginPopup.style.display === "block" &&
        !debugLoginPopup.querySelector(".modal-content").contains(event.target)) {
        debugLoginPopup.style.display = "none";
    }

    const debugEditPopup = document.getElementById("debugEditPopup");
    if (debugEditPopup.style.display === "block" &&
        !debugEditPopup.querySelector(".modal-content").contains(event.target)) {
        debugEditPopup.style.display = "none";
    }

    if (stationPopup.style.display === "block" &&
        !stationPopup.querySelector(".modal-content").contains(event.target)) {
        stationPopup.style.display = "none";
    }
});

// ------------------ STATION DROPDOWN ------------------

function populateStationDropdown(stations) {
    const dropdown = document.getElementById("stationDropdown");
    dropdown.innerHTML = "";

    stations.forEach((station, index) => {
        const option = document.createElement("option");
        option.value = JSON.stringify({ id: station.id, name: station.name });
        option.textContent = station.name;
        if (index === 0) {
            option.selected = true;
        }
        dropdown.appendChild(option);
    });

    dropdown.style.display = "inline-block";
}

function switchStation() {
    const dropdown = document.getElementById("stationDropdown");
    const selected = JSON.parse(dropdown.value);
    quickSearchById(selected.id, selected.name);
}

// ------------------ STATION SELECTION POPUP ------------------

function showStationSelect(stations) {
    const stationList = document.getElementById("stationList");
    stationList.innerHTML = "";

    stations.forEach((station) => {
        const option = document.createElement("div");
        option.className = "station-option";
        option.innerHTML = `
            <strong>${station.name}</strong><br>
            <small>ID: ${station.id}</small>
        `;
        option.onclick = () => {
            closeStationSelect();
            quickSearchById(station.id, station.name);
        };
        stationList.appendChild(option);
    });

    document.getElementById("stationSelectPopup").style.display = "block";
}

function closeStationSelect() {
    document.getElementById("stationSelectPopup").style.display = "none";
}

// Close station select popup when clicking outside
window.addEventListener("click", function(event) {
    const popup = document.getElementById("stationSelectPopup");
    if (
        popup.style.display === "block" &&
        !popup.querySelector(".modal-content").contains(event.target)
    ) {
        popup.style.display = "none";
    }
});

function toggleClearButton() {
    const input = document.getElementById("stopInput");
    const clearBtn = document.getElementById("clearInputBtn");
    if (input && clearBtn) {
        clearBtn.style.display = input.value.length > 0 ? "flex" : "none";
    }
}

function clearSearchInput() {
    const input = document.getElementById("stopInput");
    if (input) {
        input.value = "";
        input.focus();
        toggleClearButton();
    }
}

// ------------------ FAVORITES ------------------

function getFavorites() {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveFavorites(favorites) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function isFavorite(id, name) {
    return getFavorites().some(fav => fav.id === id && fav.name === name);
}

// Helper function to clean station name (display city info after comma)
function cleanStationName(fullName) {
    // First, handle the primary name stripping (before '/')
    let primaryName = fullName;
    if (primaryName.includes('/')) {
        primaryName = primaryName.split('/')[0].trim();
    }

    const parts = primaryName.split(',');
    if (parts.length > 1) {
        return parts[1].trim();
    }
    return parts[0].trim();
}

function toggleFavorite() {
    if (!stopName || stopId === null) {
        // If no station loaded yet, do nothing (error suppressed per requirement)
        if (!lastDepartures.length) {
            return;
        }
    }

    const favorites = getFavorites();
    const cleanedName = cleanStationName(stopName);
    const index = favorites.findIndex(fav => fav.id === stopId && fav.name === cleanedName);

    if (index > -1) {
        // Remove from favorites
        favorites.splice(index, 1);
    } else {
        // Add to favorites with cleaned station name and ID from API
        favorites.push({
            id: stopId,
            name: cleanedName
        });
    }

    saveFavorites(favorites);
    updateFavoriteButton();
    updateFavoritesDisplay();
}

function updateFavoriteButton() {
    const btn = document.getElementById('favoriteBtn');
    const cleanedName = cleanStationName(stopName);
    const isFav = isFavorite(stopId, cleanedName);

    if (isFav) {
        btn.classList.add('favorite-active');
        btn.setAttribute('title', 'Remove from favorites');
    } else {
        btn.classList.remove('favorite-active');
        btn.setAttribute('title', 'Add to favorites');
    }
}

function updateFavoritesDisplay() {
    const favorites = getFavorites();
    const section = document.getElementById('favoritesSection');
    const grid = document.getElementById('favoritesGrid');

    if (favorites.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';

    favorites.forEach((fav, index) => {
        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'favorite-btn-wrapper';

        const btn = document.createElement('button');
        btn.className = 'favorite-quick-btn';
        btn.innerText = fav.name;
        btn.title = fav.name;
        btn.onclick = () => {
            quickSearchById(fav.id, fav.name);
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-favorite-x';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Remove from favorites';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFavorite(index);
        };

        btnWrapper.appendChild(btn);
        btnWrapper.appendChild(removeBtn);
        grid.appendChild(btnWrapper);
    });
}

function removeFavorite(index) {
    const favorites = getFavorites();
    favorites.splice(index, 1);
    saveFavorites(favorites);
    updateFavoriteButton();
    updateFavoritesDisplay();
}

// ------------------ HOME STATION ------------------

function getHomeStation() {
    const stored = localStorage.getItem(HOME_STATION_KEY);
    return stored ? JSON.parse(stored) : null;
}

function setHomeStation() {
    if (!stopName || stopId === null) {
        if (!lastDepartures.length) {
            return;
        }
    }

    const cleanedName = cleanStationName(stopName);
    const home = getHomeStation();

    if (home && home.id === stopId && home.name === cleanedName) {
        // Already home, maybe toggle off? The description says "this will then set that station as their home"
        // Let's allow unsetting if they click it again.
        localStorage.removeItem(HOME_STATION_KEY);
    } else {
        localStorage.setItem(HOME_STATION_KEY, JSON.stringify({
            id: stopId,
            name: cleanedName
        }));
    }

    updateHomeButton();
}

function updateHomeButton() {
    const btn = document.getElementById('homeBtn');
    if (!btn) return;
    const cleanedName = cleanStationName(stopName);
    const home = getHomeStation();

    if (home && home.id === stopId && home.name === cleanedName) {
        btn.classList.add('home-active');
        btn.setAttribute('title', 'Currently your home station (click to unset)');
    } else {
        btn.classList.remove('home-active');
        btn.setAttribute('title', 'Set as home station');
    }
}

// ------------------ INITIALIZATION ------------------

function switchTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === tabId);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId + 'Tab');
    });

    if (tabId === 'map') {
        initMap();
    }
}

function initMap() {
    if (map) {
        setTimeout(() => map.invalidateSize(), 100);
        return;
    }

    // Centered on Karlsruhe: 49.0069, 8.4037
    map = L.map('map').setView([49.0069, 8.4037], 13);

    // Standard OSM base layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // ÖPNV Karte (Transit Layer)
    // This layer highlights tram tracks and bus lines
    L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: 'Map <a href="https://memomaps.de/">memomaps.de</a> <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // Add Locate Me button
    const locateControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function() {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('button', 'locate-btn', container);
            button.title = "Locate Me";
            button.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
            `;
            button.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                locateUser();
            };
            return container;
        }
    });
    map.addControl(new locateControl());

    map.on('moveend', () => {
        if (map.getZoom() >= 15) {
            updateOverpassMarkers();
        } else {
            markersLayer.clearLayers();
        }
    });

    if (map.getZoom() >= 15) {
        updateOverpassMarkers();
    }
}

// Helper function to normalize station names for grouping
function normalizeStationName(name) {
    if (!name) return "Unknown Stop";
    // Remove content in parentheses, e.g., "Europaplatz (U)" -> "Europaplatz"
    // Also remove secondary info after '/', e.g., "Knielinger Allee/Städtisches Klinikum" -> "Knielinger Allee"
    let normalized = name.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (normalized.includes('/')) {
        normalized = normalized.split('/')[0].trim();
    }
    return normalized;
}

async function updateOverpassMarkers() {
    const loadingIndicator = document.getElementById('mapLoading');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';

    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Overpass query for public transport stops
    const query = `
        [out:json][timeout:25];
        (
          node["public_transport"~"stop_position|platform"](${sw.lat},${sw.lng},${ne.lat},${ne.lng});
          node["highway"="bus_stop"](${sw.lat},${sw.lng},${ne.lat},${ne.lng});
          node["railway"~"tram_stop|halt|station"](${sw.lat},${sw.lng},${ne.lat},${ne.lng});
        );
        out body;
    `;

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        });
        const data = await response.json();
        
        markersLayer.clearLayers();

        const stopsByName = {};

        data.elements.forEach(element => {
            const rawName = element.tags.name;
            
            // Skip elements without a name or with "Unknown" names
            if (!rawName || rawName.toLowerCase().includes("unknown") || rawName.toLowerCase().includes("unbekannt")) {
                return;
            }

            const normalizedName = normalizeStationName(rawName);
            
            if (!stopsByName[normalizedName]) {
                stopsByName[normalizedName] = {
                    count: 0,
                    latSum: 0,
                    lonSum: 0,
                    isDB: false
                };
            }
            stopsByName[normalizedName].count++;
            stopsByName[normalizedName].latSum += element.lat;
            stopsByName[normalizedName].lonSum += element.lon;

            // Check for DB services at this node (Regional and Long-distance trains)
            // Explicitly exclude S-Bahn, U-Bahn, trams, and buses
            const tags = element.tags || {};
            const isTrain = tags.train === 'yes' || 
                           tags.railway === 'station' ||
                           tags.railway === 'halt';
            
            const isLongDistanceOrRegional = tags.ice === 'yes' || 
                                           tags.ic === 'yes' || 
                                           tags.re === 'yes' || 
                                           tags.rb === 'yes' ||
                                           tags.mex === 'yes';

            const isExcluded = tags.s_bahn === 'yes' ||
                             tags.subway === 'yes' ||
                             tags.tram === 'yes' ||
                             tags.bus === 'yes';
            
            if ((isTrain || isLongDistanceOrRegional) && !isExcluded) {
                stopsByName[normalizedName].isDB = true;
            }
        });

        for (const name in stopsByName) {
            const info = stopsByName[name];
            const avgLat = info.latSum / info.count;
            const avgLon = info.lonSum / info.count;
            
            const iconSrc = info.isDB ? '/static/icons/db.png' : '/static/icons/busstop.png';
            
            // Custom station icon
            const stationIcon = L.icon({
                iconUrl: iconSrc,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -12]
            });

            const marker = L.marker([avgLat, avgLon], { icon: stationIcon });
            
            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
                <div style="font-family: sans-serif; min-width: 150px;">
                    <strong style="display: block; margin-bottom: 8px;">${name}</strong>
                    <button class="search-btn" style="padding: 6px 12px; font-size: 12px; width: 100%;" 
                            onclick="selectStationFromMap('${name.replace(/'/g, "\\'")}')">
                        View Departures
                    </button>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            markersLayer.addLayer(marker);
        }
    } catch (error) {
        console.error('Error fetching Overpass data:', error);
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

function selectStationFromMap(name) {
    switchTab('departures');
    document.getElementById('stopInput').value = name;
    searchStop();
}

function locateUser() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            const latlng = [latitude, longitude];

            if (userMarker) {
                map.removeLayer(userMarker);
            }

            // Custom icon for user location
            const userIcon = L.divIcon({
                className: 'user-location-marker',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            userMarker = L.layerGroup([
                L.marker(latlng, { icon: userIcon }),
                L.circle(latlng, { radius: accuracy, weight: 1, fillOpacity: 0.1, color: '#2196F3' })
            ]).addTo(map);

            map.setView(latlng, 16);
        },
        (error) => {
            console.error("Error getting location:", error);
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

window.addEventListener("DOMContentLoaded", function() {
    // Trigger search when user presses Enter in stop input
    document.getElementById("stopInput").addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            searchStop();
        }
    });

    updateFavoritesDisplay();
    
    // Auto-login if password is saved
    if (debugPassword) {
        debugMode = true;
        const updateBtn = document.getElementById("updateNowBtn");
        if (updateBtn) updateBtn.style.display = "block";
        const pauseBtn = document.getElementById("pauseUpdatesBtn");
        if (pauseBtn) pauseBtn.style.display = "block";
        const leaveBtn = document.getElementById("leaveDebugBtn");
        if (leaveBtn) leaveBtn.style.display = "block";
        const mapBtn = document.getElementById("mapTabBtn");
        if (mapBtn) mapBtn.style.display = "block";
    }

    const home = getHomeStation();
    if (home) {
        if (home.id) {
            quickSearchById(home.id, home.name);
        } else {
            quickSearch(home.name);
        }
    } else {
        quickSearch("Hauptbahnhof Vorplatz");
    }
});

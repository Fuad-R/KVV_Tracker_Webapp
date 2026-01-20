let stopName = "";
let stopId = null;
let countdown = 30;
let countdownInterval;
let refreshInterval;
let lastDepartures = [];
const FAVORITES_KEY = 'kvv_favorites';

// ------------------ SEARCH (BY NAME) ------------------

function searchStop() {
    stopId = null; // reset ID-based search

    stopName = document.getElementById("stopInput").value.trim();
    if (!stopName) return;

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";

    fetchDepartures();

    if (refreshInterval) clearInterval(refreshInterval);
    if (countdownInterval) clearInterval(countdownInterval);

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(fetchDepartures, 30000);
}

// ------------------ QUICK SEARCH (BY NAME) ------------------

function quickSearch(station) {
    document.getElementById("stopInput").value = station;
    searchStop();
}

// ------------------ QUICK SEARCH (BY ID) ------------------

function quickSearchById(id, displayName) {
    stopId = id;
    stopName = displayName;

    document.getElementById("stopInput").value = displayName;
    document.getElementById("stationHeader").innerText = displayName;

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";

    fetchDeparturesById();

    if (refreshInterval) clearInterval(refreshInterval);
    if (countdownInterval) clearInterval(countdownInterval);

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(fetchDeparturesById, 30000);
}

// ------------------ COUNTDOWN ------------------

function updateCountdown() {
    const minutes = Math.floor(countdown / 60) || 0;
    const seconds = countdown % 60;
    document.getElementById("countdown").innerText = `${seconds}s`;
    countdown--;
    if (countdown < 0) countdown = 30;
}

// ------------------ FETCH (BY NAME) ------------------

async function fetchDepartures() {
    document.getElementById("loading").style.display = "block";

    try {
        const res = await fetch(`/search?stop=${stopName}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        const fullStationName = result.station_name;
        document.getElementById("stationHeader").innerText = fullStationName;

        // Store the full station name and ID from API
        stopName = fullStationName;
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
    } catch (e) {
        console.error(e);
    } finally {
        document.getElementById("loading").style.display = "none";
    }
}

// ------------------ FETCH (BY ID) ------------------

async function fetchDeparturesById() {
    document.getElementById("loading").style.display = "block";

    try {
        const res = await fetch(`/search_by_id?stop_id=${stopId}&station_name=${encodeURIComponent(stopName)}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        document.getElementById("stationHeader").innerText =
            result.station_name;

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
        updateFavoriteButton();
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

    const filtered = lastDepartures.filter(d => {
        let lineMatch = true;
        let typeMatch = true;

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

        return lineMatch && typeMatch;
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
                card.style.borderLeftColor = d.color;

                const iconHtml = getLineIcon(d.line);
                const realtimeBadge = d.is_realtime
                    ? '<div class="realtime-badge">Real-time</div>'
                    : '';

                // Display "Arriving now" for 0-1 minutes
                const departureDisplay = d.minutes_remaining <= 1
                    ? 'Arriving now'
                    : d.departure_display;

                const wheelchairEmoji = d.wheelchair_accessible === true || d.wheelchair_accessible === "true"
                    ? ' ♿'
                    : '';

                card.innerHTML = `
                    <div class="line-info">
                        <div class="line-icon">${iconHtml}</div>
                        <div>
                            <div class="line-number" style="color: ${d.color};">${d.line}</div>
                            <div class="direction">${d.direction}</div>
                        </div>
                    </div>
                    <div class="time-section">
                        <div class="departure-time">${departureDisplay}${wheelchairEmoji}</div>
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
        const res = await fetch(
            `/future_departures?stop=${stopName}&line=${line}&direction=${direction}`
        );
        const data = await res.json();

        document.getElementById("popupHeader").innerText = `Line ${line} towards ${direction}`;

        const futureList = document.getElementById("futureList");
        futureList.innerHTML = "";

        data.forEach(d => {
            const item = document.createElement("div");
            item.className = "future-item";

            const realtimeText = d.is_realtime ? 'Real-time' : 'Scheduled';
            const wheelchairEmoji = d.wheelchair_accessible === true || d.wheelchair_accessible === "true"
                ? ' ♿'
                : '';

            item.innerHTML = `
                <div>
                    <div class="future-time">${d.departure_display}${wheelchairEmoji}</div>
                    <div class="future-platform">Platform ${d.platform}</div>
                </div>
                <div class="future-realtime">${realtimeText}</div>
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

// ------------------ CLICK OUTSIDE POPUP ------------------

window.addEventListener("click", function(event) {
    const popup = document.getElementById("popup");
    const stationPopup = document.getElementById("stationSelectPopup");

    if (popup.style.display === "block" &&
        !popup.querySelector(".modal-content").contains(event.target)) {
        popup.style.display = "none";
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
    const parts = fullName.split(',');
    if (parts.length > 1) {
        return parts[1].trim();
    }
    return parts[0].trim();
}

function toggleFavorite() {
    if (!stopName || stopId === null) {
        // If no station loaded yet, show message
        if (!lastDepartures.length) {
            alert('Please search for a station first');
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
        btn.onclick = (e) => {
            if (e.target.closest('.remove-favorite-x')) return;
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

function showManageFavorites() {
    const favorites = getFavorites();
    const stationList = document.getElementById('stationList');
    stationList.innerHTML = '';

    const modalTitle = document.querySelector('.modal-title');
    modalTitle.innerText = 'Manage Favorites';

    if (favorites.length === 0) {
        stationList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No favorites yet</p>';
    } else {
        favorites.forEach((fav, index) => {
            const option = document.createElement('div');
            option.className = 'favorite-manage-item';
            option.innerHTML = `
                <div class="favorite-manage-info">
                    <strong>${fav.name}</strong>
                    <div style="font-size: 12px; color: var(--text-tertiary);">ID: ${fav.id}</div>
                </div>
                <button class="remove-favorite-btn" onclick="removeFavorite(${index})">Remove</button>
            `;
            stationList.appendChild(option);
        });
    }

    document.getElementById('stationSelectPopup').style.display = 'block';
}

function removeFavorite(index) {
    const favorites = getFavorites();
    favorites.splice(index, 1);
    saveFavorites(favorites);
    updateFavoriteButton();
    updateFavoritesDisplay();
}

// ------------------ INITIALIZATION ------------------

window.addEventListener("DOMContentLoaded", function() {
    // Trigger search when user presses Enter in stop input
    document.getElementById("stopInput").addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            searchStop();
        }
    });

    updateFavoritesDisplay();
    quickSearch("Hauptbahnhof Vorplatz");
});

let stopName = "";
let stopId = null; // when set, bypass name search
let countdown = 30;
let countdownInterval;
let refreshInterval;
let lastDepartures = []; // store last fetched departures for filtering
let mapMode = false;

function serializeFilters() {
    const parts = [];
    const line = document.getElementById("lineFilter").value.trim();
    const type = document.getElementById("typeFilter").value;
    const accessible = document.getElementById("accessibilityFilter").value;

    if (line) parts.push(`line=${encodeURIComponent(line)}`);
    if (type) parts.push(`type=${encodeURIComponent(type)}`);
    if (accessible) parts.push(`accessible=${encodeURIComponent(accessible)}`);
    return parts.join(",");
}

function applyFiltersFromPath(filters) {
    const values = {};
    if (filters) {
        filters.split(",").forEach(part => {
            const [key, value] = part.split("=");
            if (key && value) values[key] = decodeURIComponent(value);
        });
    }
    document.getElementById("lineFilter").value = values.line || "";
    document.getElementById("typeFilter").value = values.type || "";
    document.getElementById("accessibilityFilter").value = values.accessible || "";
}

function updateUrlFromState() {
    let nextPath = "/";
    if (mapMode) nextPath = "/map";
    else if (stopId) {
        const filters = serializeFilters();
        nextPath = `/${encodeURIComponent(stopId)}${filters ? `/${filters}` : ""}`;
    }
    if (window.location.pathname !== nextPath) {
        window.history.pushState({}, "", nextPath);
    }
}

function setMapMode(enabled) {
    mapMode = enabled;
    if (enabled) {
        stopId = null;
        stopName = "";
        document.getElementById("stationHeader").innerText = "Map mode";
    }
    updateUrlFromState();
}

function readAccessible(departure) {
    const candidates = [
        departure.wheelchair_accessible,
        departure.is_barrier_free,
        departure.barrier_free,
        departure.accessible,
        departure.disabled_access
    ];
    const value = candidates.find(v => v !== undefined && v !== null);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.toLowerCase();
        if (["true", "yes", "1"].includes(normalized)) return true;
        if (["false", "no", "0"].includes(normalized)) return false;
    }
    return null;
}

// ------------------ SEARCH (BY NAME) ------------------

function searchStop() {
    setMapMode(false);
    stopId = null; // reset ID-based search

    stopName = document.getElementById("stopInput").value.trim();
    if (!stopName) return;

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
    setMapMode(false);
    stopId = id;
    stopName = displayName;

    document.getElementById("stopInput").value = displayName;
    document.getElementById("stationHeader").innerText = displayName;

    fetchDeparturesById();

    if (refreshInterval) clearInterval(refreshInterval);
    if (countdownInterval) clearInterval(countdownInterval);

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(fetchDeparturesById, 30000);
}

// ------------------ COUNTDOWN ------------------

function updateCountdown() {
    document.getElementById("countdown").innerText =
        `Next update in: ${countdown} s`;
    countdown--;
    if (countdown < 0) countdown = 30;
}

// ------------------ FETCH (BY NAME) ------------------

async function fetchDepartures() {
    try {
        const res = await fetch(`/search?stop=${stopName}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        document.getElementById("stationHeader").innerText =
            result.station_name;
        stopName = result.station_name || stopName;
        stopId = result.stop_id || stopId;

        lastDepartures = result.departures;
        applyFilter();
        updateUrlFromState();
        countdown = 30;
    } catch (e) {
        console.error(e);
    }
}

// ------------------ FETCH (BY ID) ------------------

async function fetchDeparturesById() {
    try {
        const res = await fetch(`/search_by_id?stop_id=${stopId}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            return;
        }

        document.getElementById("stationHeader").innerText =
            result.station_name;
        stopName = result.station_name || stopName;
        stopId = result.stop_id || stopId;

        lastDepartures = result.departures;
        applyFilter();
        updateUrlFromState();
        countdown = 30;
    } catch (e) {
        console.error(e);
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
    const accessibilityFilter = document.getElementById("accessibilityFilter").value;

    const filtered = lastDepartures.filter(d => {
        let lineMatch = true;
        let typeMatch = true;
        let accessibilityMatch = true;

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

        if (accessibilityFilter) {
            const isAccessible = readAccessible(d);
            if (accessibilityFilter === "yes") accessibilityMatch = isAccessible === true;
            if (accessibilityFilter === "no") accessibilityMatch = isAccessible === false;
        }

        return lineMatch && typeMatch && accessibilityMatch;
    });

    populateTable(filtered);
    updateUrlFromState();
}

// ------------------ TABLE ------------------

function populateTable(data) {
    const tbody = document.querySelector("#departuresTable tbody");
    tbody.innerHTML = "";

    const platforms = {};
    data.forEach(d => {
        if (!platforms[d.platform]) platforms[d.platform] = [];
        platforms[d.platform].push(d);
    });

    Object.keys(platforms)
        .sort((a, b) => a.localeCompare(b))
        .forEach(platform => {
            const headerRow = document.createElement("tr");
            headerRow.innerHTML =
                `<td colspan="5" class="platform-header">Platform ${platform}</td>`;
            tbody.appendChild(headerRow);

            platforms[platform]
                .sort((a, b) => a.minutes_remaining - b.minutes_remaining)
                .forEach(d => {
                    const tr = document.createElement("tr");
                    const iconHtml = getLineIcon(d.line);

                    tr.innerHTML = `
                        <td>${d.platform}</td>
                        <td style="color:${d.color}">
                            ${iconHtml} ${d.line}
                        </td>
                        <td>${d.direction}</td>
                        <td>${d.is_realtime ? "Yes" : "No"}</td>
                        <td>${d.departure_display}</td>
                    `;

                    tr.onclick = () => showFuture(d.line, d.direction);
                    tbody.appendChild(tr);
                });
        });
}

// ------------------ FUTURE POPUP ------------------

async function showFuture(line, direction) {
    try {
        const res = await fetch(
            `/future_departures?stop=${stopName}&line=${line}&direction=${direction}`
        );
        const data = await res.json();

        document.getElementById("popupHeader").innerText =
            `Line ${line} towards ${direction}`;

        const tbody = document.querySelector("#futureTable tbody");
        tbody.innerHTML = "";

        data.forEach(d => {
            const tr = document.createElement("tr");
            const iconHtml = getLineIcon(d.line);

            tr.innerHTML = `
                <td>${d.platform}</td>
                <td>${iconHtml} ${d.departure_display}</td>
                <td>${d.is_realtime ? "Yes" : "No"}</td>
            `;
            tbody.appendChild(tr);
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
    if (
        popup.style.display === "block" &&
        !popup.querySelector(".popup-content").contains(event.target)
    ) {
        popup.style.display = "none";
    }
});

// ------------------ ENTER KEY SEARCH ------------------

// Trigger search when user presses Enter in stop input
document.getElementById("stopInput").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        searchStop();
    }
});

(function initFromUrl() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) return;

    if (path === "map") {
        setMapMode(true);
        return;
    }

    const parts = path.split("/");
    if (parts.length >= 1) {
        stopId = decodeURIComponent(parts[0]);
        if (parts[1]) applyFiltersFromPath(parts[1]);
        fetchDeparturesById();
        if (refreshInterval) clearInterval(refreshInterval);
        if (countdownInterval) clearInterval(countdownInterval);
        countdown = 30;
        countdownInterval = setInterval(updateCountdown, 1000);
        refreshInterval = setInterval(fetchDeparturesById, 30000);
    }
})();

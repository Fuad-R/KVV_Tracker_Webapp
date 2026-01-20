let stopName = "";
let stopId = null;
let countdown = 30;
let countdownInterval;
let refreshInterval;
let lastDepartures = [];

// ------------------ SEARCH (BY NAME) ------------------

function searchStop() {
    stopId = null; // reset ID-based search

    const stopInput = document.getElementById("stopInput");
    const stopInputModern = document.getElementById("stopInputModern");
    stopName = stopInput.value.trim() || stopInputModern.value.trim();

    if (!stopName) {
        return;
    }

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("lineFilterModern").value = "";
    document.getElementById("typeFilterModern").value = "";

    fetchDepartures();

    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(fetchDepartures, 30000);
}

// ------------------ QUICK SEARCH (BY NAME) ------------------

function quickSearch(station) {
    const stopInput = document.getElementById("stopInput");
    const stopInputModern = document.getElementById("stopInputModern");
    stopInput.value = station;
    stopInputModern.value = station;
    searchStop();
}

// ------------------ QUICK SEARCH (BY ID) ------------------

function quickSearchById(id, displayName) {
    stopId = id;
    stopName = displayName;

    const stopInput = document.getElementById("stopInput");
    const stopInputModern = document.getElementById("stopInputModern");
    stopInput.value = displayName;
    stopInputModern.value = displayName;

    const stationHeader = document.getElementById("stationHeader");
    const stationHeaderModern = document.getElementById("stationHeaderModern");
    stationHeader.innerText = displayName;
    stationHeaderModern.innerText = displayName;

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("lineFilterModern").value = "";
    document.getElementById("typeFilterModern").value = "";

    fetchDeparturesById();

    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdown = 30;
    countdownInterval = setInterval(updateCountdown, 1000);
    refreshInterval = setInterval(fetchDeparturesById, 30000);
}

// ------------------ COUNTDOWN ------------------

function updateCountdown() {
    const isModern = document.getElementById('uiModeToggle').checked;

    if (isModern) {
        document.getElementById('countdownModern').innerText = `Next update in: ${countdown}s`;
    } else {
        document.getElementById('countdown').innerText = `Next update in: ${countdown} s`;
    }

    countdown--;
    if (countdown < 0) {
        countdown = 30;
    }
}

// ------------------ FETCH (BY NAME) ------------------

async function fetchDepartures() {
    const loading = document.getElementById("loading");
    const loadingModern = document.getElementById("loadingModern");
    const isModern = document.getElementById('uiModeToggle').checked;

    if (isModern) {
        loadingModern.style.display = "block";
    } else {
        loading.style.display = "block";
    }

    try {
        const res = await fetch(`/search?stop=${stopName}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            if (isModern) loadingModern.style.display = "none";
            else loading.style.display = "none";
            return;
        }

        const stationHeader = document.getElementById("stationHeader");
        const stationHeaderModern = document.getElementById("stationHeaderModern");
        stationHeader.innerText = result.station_name;
        stationHeaderModern.innerText = result.station_name;

        // Populate dropdown if multiple stations available
        if (result.all_stations) {
            populateStationDropdown(result.all_stations);
            populateStationDropdownModern(result.all_stations);
        } else {
            // Hide dropdown if only one station
            document.getElementById("stationDropdown").style.display = "none";
            document.getElementById("stationDropdownModern").style.display = "none";
        }

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
    } catch (e) {
        console.error(e);
    } finally {
        loading.style.display = "none";
        loadingModern.style.display = "none";
    }
}

// ------------------ FETCH (BY ID) ------------------

async function fetchDeparturesById() {
    const loading = document.getElementById("loading");
    const loadingModern = document.getElementById("loadingModern");
    const isModern = document.getElementById('uiModeToggle').checked;

    if (isModern) {
        loadingModern.style.display = "block";
    } else {
        loading.style.display = "block";
    }

    try {
        const res = await fetch(`/search_by_id?stop_id=${stopId}&station_name=${encodeURIComponent(stopName)}`);
        const result = await res.json();

        if (result.error) {
            console.error(result.error);
            if (isModern) loadingModern.style.display = "none";
            else loading.style.display = "none";
            return;
        }

        const stationHeader = document.getElementById("stationHeader");
        const stationHeaderModern = document.getElementById("stationHeaderModern");
        stationHeader.innerText = result.station_name;
        stationHeaderModern.innerText = result.station_name;

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
    } catch (e) {
        console.error(e);
    } finally {
        loading.style.display = "none";
        loadingModern.style.display = "none";
    }
}

// ------------------ LINE ICON ------------------

function getLineIcon(line) {
    const lineLower = line.toLowerCase();
    const lineNumber = parseInt(line, 10);

    if (lineLower.startsWith("s")) {
        return "<img src=\"/static/icons/sbahn.png\" class=\"line-icon\">";
    } else if (!isNaN(lineNumber) && lineNumber >= 1 && lineNumber <= 9) {
        // Trams
        return "<img src=\"/static/icons/tram.png\" class=\"line-icon\">";
    } else if (lineLower.startsWith("u")) {
        // UBahn
        return "<img src=\"/static/icons/ubahn.png\" class=\"line-icon\">";
    } else if (lineLower.startsWith("n")) {
        // Nightline
        return "<img src=\"/static/icons/nl.png\" class=\"line-icon\">";
    } else if (lineLower.startsWith("sncf") || lineLower.startsWith("tgv")) {
        // French trains
        return "<img src=\"/static/icons/sncf.png\" class=\"line-icon\">";
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
        return "<img src=\"/static/icons/db.png\" class=\"line-icon\">";
    } else if (!isNaN(lineNumber) && lineNumber >= 10) {
        // Buses
        return "<img src=\"/static/icons/bus.png\" class=\"line-icon\">";
    }
    return "";
}

// ------------------ FILTERING ------------------

function applyFilter() {
    const lineFilter = document.getElementById("lineFilter").value.trim();
    const typeFilter = document.getElementById("typeFilter").value;

    const filtered = lastDepartures.filter((d) => {
        let lineMatch = true;
        let typeMatch = true;

        // Line filter
        if (lineFilter) {
            if (d.line.toLowerCase().startsWith("s")) {
                lineMatch = d.line.toLowerCase() === lineFilter.toLowerCase();
            } else {
                lineMatch = parseInt(d.line, 10) === parseInt(lineFilter, 10);
            }
        }

        // Type filter
        if (typeFilter) {
            const isSbahn = d.line.toLowerCase().startsWith("s");
            const lineNumber = parseInt(d.line, 10);

            if (typeFilter === "s") {
                typeMatch = isSbahn;
            } else if (typeFilter === "tram") {
                typeMatch = !isSbahn && lineNumber >= 1 && lineNumber <= 9;
            } else if (typeFilter === "bus") {
                typeMatch = !isSbahn && lineNumber >= 10;
            }
        }

        return lineMatch && typeMatch;
    });

    populateTable(filtered);
    populateTableModern(filtered);
}

// ------------------ TABLE ------------------

function populateTable(data) {
    const tbody = document.querySelector("#departuresTable tbody");
    tbody.innerHTML = "";

    const platforms = {};
    data.forEach((d) => {
        if (!platforms[d.platform]) {
            platforms[d.platform] = [];
        }
        platforms[d.platform].push(d);
    });

    Object.keys(platforms)
        .sort((a, b) => {
            return a.localeCompare(b);
        })
        .forEach((platform) => {
            const headerRow = document.createElement("tr");
            headerRow.innerHTML =
                `<td colspan="5" class="platform-header">Platform ${platform}</td>`;
            tbody.appendChild(headerRow);

            platforms[platform]
                .sort((a, b) => {
                    return a.minutes_remaining - b.minutes_remaining;
                })
                .forEach((d) => {
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

                    tr.onclick = () => {
                        return showFuture(d.line, d.direction);
                    };
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

        const popupHeader = document.getElementById("popupHeader");
        popupHeader.innerText = `Line ${line} towards ${direction}`;

        const tbody = document.querySelector("#futureTable tbody");
        tbody.innerHTML = "";

        data.forEach((d) => {
            const tr = document.createElement("tr");
            const iconHtml = getLineIcon(d.line);

            tr.innerHTML = `
                <td>${d.platform}</td>
                <td>${iconHtml} ${d.departure_display}</td>
                <td>${d.is_realtime ? "Yes" : "No"}</td>
            `;
            tbody.appendChild(tr);
        });

        const popup = document.getElementById("popup");
        popup.style.display = "block";
    } catch (e) {
        console.error(e);
    }
}

// ------------------ STATION SELECTION ------------------

function showStationSelect(stations) {
    const stationList = document.getElementById("stationList");
    stationList.innerHTML = "";

    stations.forEach((station) => {
        const option = document.createElement("div");
        option.className = "station-option";
        option.innerHTML = `
            <div class="station-option-name">${station.name}</div>
            <div class="station-option-id">ID: ${station.id}</div>
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
    closeStationSelectModern();
}

// ------------------ STATION DROPDOWN ------------------

function populateStationDropdown(stations) {
    const dropdown = document.getElementById("stationDropdown");
    dropdown.innerHTML = "";

    stations.forEach((station, index) => {
        const option = document.createElement("option");
        option.value = JSON.stringify({id: station.id, name: station.name});
        option.textContent = station.name;
        if (index === 0) {
            option.selected = true;
        }
        dropdown.appendChild(option);
    });

    dropdown.style.display = "inline-block";
}

function populateStationDropdownModern(stations) {
    const dropdown = document.getElementById("stationDropdownModern");
    dropdown.innerHTML = "";

    stations.forEach((station, index) => {
        const option = document.createElement("option");
        option.value = JSON.stringify({id: station.id, name: station.name});
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
    const dropdownModern = document.getElementById("stationDropdownModern");
    const isModern = document.getElementById('uiModeToggle').checked;

    const selected = isModern
        ? JSON.parse(dropdownModern.value)
        : JSON.parse(dropdown.value);

    quickSearchById(selected.id, selected.name);
}

// ------------------ CLOSE POPUP ------------------

function closePopup() {
    document.getElementById("popup").style.display = "none";
    closePopupModern();
}

// ------------------ CLICK OUTSIDE POPUP ------------------

window.addEventListener("click", (event) => {
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
document.getElementById("stopInput").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
        searchStop();
    }
});

const stopInputModern = document.getElementById("stopInputModern");
if (stopInputModern) {
    stopInputModern.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            searchStop();
        }
    });
}

// ------------------ AUTO-LOAD DEFAULT STATION ------------------

// Load default station on page load
window.addEventListener("DOMContentLoaded", () => {
    quickSearch("hauptbahnhof (vorplatz)");
});

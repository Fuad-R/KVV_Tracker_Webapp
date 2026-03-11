let stopName = "";
let stopId = null;
const DEBUG_PASSWORD_KEY = "debugPassword";
const appConfig = window.APP_CONFIG || {};
const devModeEnabled = appConfig.devMode === true;
const notificationApiBaseUrl = devModeEnabled
    ? "https://transitapi-dev.fuadserver.uk/api"
    : "https://transitapi.fuadserver.uk/api";
const storedDebugPassword = localStorage.getItem(DEBUG_PASSWORD_KEY) || "";
let debugPassword = storedDebugPassword;
let debugMode = devModeEnabled || !!debugPassword;

// ================== DEBUG LOGGING ==================
// Debug logging utility - only active in dev mode
const DevLog = {
    _enabled: devModeEnabled,
    _formatTimestamp: () => new Date().toISOString().slice(11, 23),
    _log: (category, message, data = null) => {
        if (!DevLog._enabled) return;
        const timestamp = DevLog._formatTimestamp();
        const prefix = `[${timestamp}] [${category}]`;
        if (data !== null) {
            console.log(`%c${prefix}%c ${message}`, 'color: #0088cc; font-weight: bold', 'color: inherit', data);
        } else {
            console.log(`%c${prefix}%c ${message}`, 'color: #0088cc; font-weight: bold', 'color: inherit');
        }
    },
    api: (endpoint, method = 'GET', params = null) => {
        DevLog._log('API', `${method} ${endpoint}`, params);
    },
    apiResponse: (endpoint, status, data = null) => {
        const statusColor = status >= 200 && status < 300 ? '#2e7d32' : '#c62828';
        if (!DevLog._enabled) return;
        const timestamp = DevLog._formatTimestamp();
        console.log(
            `%c[${timestamp}] [API-RESPONSE]%c ${endpoint} %c[${status}]`,
            'color: #0088cc; font-weight: bold',
            'color: inherit',
            `color: ${statusColor}; font-weight: bold`,
            data
        );
    },
    notification: (action, data = null) => {
        DevLog._log('NOTIFICATION', action, data);
    },
    state: (action, data = null) => {
        DevLog._log('STATE', action, data);
    },
    filter: (action, data = null) => {
        DevLog._log('FILTER', action, data);
    },
    ui: (action, data = null) => {
        DevLog._log('UI', action, data);
    },
    map: (action, data = null) => {
        DevLog._log('MAP', action, data);
    },
    storage: (action, data = null) => {
        DevLog._log('STORAGE', action, data);
    },
    location: (action, data = null) => {
        DevLog._log('LOCATION', action, data);
    },
    error: (category, message, error = null) => {
        if (!DevLog._enabled) return;
        const timestamp = DevLog._formatTimestamp();
        console.error(`%c[${timestamp}] [${category}-ERROR]%c ${message}`, 'color: #c62828; font-weight: bold', 'color: inherit', error);
    }
};
let countdown = 30;
let countdownInterval;
let refreshInterval;
let updatesPaused = false;
let lastDepartures = [];
let map = null;
let markersLayer = null;
let userMarker = null;
let searchTimeout = null;
let openMapPopupName = null;
let isRefreshingMapMarkers = false;
let mapOverpassRequestId = 0;
const mapOverpassActiveRequests = new Set();
const FAVORITES_KEY = 'transit_favorites';
const FAVORITES_COLLAPSED_KEY = 'transit_favorites_collapsed';
const HOME_STATION_KEY = 'transit_home_station';
const EXPERIMENTAL_KEY = 'transit_experimental_enabled';
const DEV_LOCATION_KEY = 'transit_dev_location_override';
const NOTIFICATION_SETTINGS_DEFAULTS = {
    heightPercent: 100,
    textSizePx: 14,
    scrollDuration: null
};
let notificationSettings = { ...NOTIFICATION_SETTINGS_DEFAULTS };
const APP_STORAGE_KEYS = [
    FAVORITES_KEY,
    FAVORITES_COLLAPSED_KEY,
    HOME_STATION_KEY,
    EXPERIMENTAL_KEY,
    DEV_LOCATION_KEY,
    DEBUG_PASSWORD_KEY
];
const MAP_POPUP_CACHE = new Map();
const MAP_POPUP_CACHE_TTL_MS = 60 * 1000;
const MAP_CITY_CACHE = new Map();
const MAP_CITY_CACHE_TTL_MS = 10 * 60 * 1000;
const MAP_CITY_CACHE_PRECISION = 3;
const MAP_CITY_MIN_REQUEST_INTERVAL_MS = 1000;
const MAP_CITY_FAILURE_WARN_THRESHOLD = 3;
const MAP_CITY_NOMINATIM_URL = (typeof window !== "undefined" && window.NOMINATIM_URL)
    ? window.NOMINATIM_URL
    : "https://nominatim.openstreetmap.org/reverse";
const MAP_STOP_ICON_OPTIONS = {
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
};
const MAP_STOP_ICONS = {
    db: L.icon({ ...MAP_STOP_ICON_OPTIONS, iconUrl: "/static/icons/db.png" }),
    bus: L.icon({ ...MAP_STOP_ICON_OPTIONS, iconUrl: "/static/icons/busstop.png" })
};
const MAP_STOP_ICON_READY = (() => {
    const preloadPromises = Object.values(MAP_STOP_ICONS).map(icon => {
        const iconUrl = icon.options.iconUrl;
        return new Promise(resolve => {
            const img = new Image();
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                if (error) {
                    const errorDetail = error?.type || error?.message || error;
                    console.warn("Stop icon preload failed for", iconUrl, ":", errorDetail);
                    resolve(false);
                    return;
                }
                resolve(true);
            };
            img.onload = () => finish();
            img.onerror = (event) => finish(event);
            img.src = iconUrl;
            if (img.complete) {
                finish();
            }
        });
    });
    return Promise.all(preloadPromises).then(results => results.every(Boolean));
})();
// Respect Nominatim usage policy with throttled lookups and a custom User-Agent.
let mapCityLastRequestAt = 0;
let mapCityFailureCount = 0;
let mapCityRequestChain = Promise.resolve();
let isApplyingUrlState = false;

/**
 * Escape HTML special characters to prevent XSS when inserting text into innerHTML.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseFiltersSegment(segment) {
    if (!segment) return {};
    return segment.split(';').reduce((filters, entry) => {
        const [rawKey, rawValue = ""] = entry.split('=');
        const key = rawKey ? rawKey.trim() : "";
        const value = rawValue.trim();
        if (key === "line" && value) filters.line = value;
        if (key === "type" && value) filters.type = value;
        if (key === "wheelchair") filters.wheelchair = value === "1";
        return filters;
    }, {});
}

function buildFiltersSegment() {
    const parts = [];
    const lineFilter = document.getElementById("lineFilter").value.trim();
    const typeFilter = document.getElementById("typeFilter").value;
    const wheelchairFilter = document.getElementById("wheelchairFilter").checked;

    if (lineFilter) parts.push(`line=${lineFilter}`);
    if (typeFilter) parts.push(`type=${typeFilter}`);
    if (wheelchairFilter) parts.push("wheelchair=1");
    return parts.join(';');
}

function setFilterInputs(filters = {}) {
    document.getElementById("lineFilter").value = filters.line || "";
    document.getElementById("typeFilter").value = filters.type || "";
    document.getElementById("wheelchairFilter").checked = !!filters.wheelchair;
}

function getUrlStateFromPath() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (!segments.length) {
        return { mode: "departures" };
    }

    if (segments[0].toLowerCase() === "map") {
        return { mode: "map" };
    }

    const stopIdFromPath = decodeURIComponent(segments[0]);
    const filters = parseFiltersSegment(decodeURIComponent(segments[1] || ""));
    return { mode: "station", stopId: stopIdFromPath, filters };
}

function syncUrlFromState(replace = false) {
    if (isApplyingUrlState) return;

    let targetPath = "/";
    if (document.getElementById("mapTab").classList.contains("active")) {
        targetPath = "/map";
    } else if (stopId) {
        const filtersSegment = buildFiltersSegment();
        targetPath = `/${encodeURIComponent(stopId)}`;
        if (filtersSegment) {
            targetPath += `/${encodeURIComponent(filtersSegment)}`;
        }
    }

    if (window.location.pathname === targetPath && !replace) return;
    const stateMethod = replace ? "replaceState" : "pushState";
    DevLog.state(`URL sync: ${stateMethod}`, { from: window.location.pathname, to: targetPath });
    window.history[stateMethod]({}, "", targetPath);
}

function applyUrlState() {
    const state = getUrlStateFromPath();
    DevLog.state('Applying URL state', state);
    isApplyingUrlState = true;
    try {
        if (state.mode === "map") {
            switchTab("map");
            return;
        }

        switchTab("departures");
        if (state.mode === "station" && state.stopId) {
            setFilterInputs(state.filters);
            quickSearchById(state.stopId, "", { resetFilters: false, skipDisplayUpdate: true });
        }
    } finally {
        isApplyingUrlState = false;
    }
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
}

function normalizeCoordinateNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    // Some APIs (e.g. HAFAS x/y) return coordinates as microdegrees; 180,000,000 == 180° * 1e6.
    if (Math.abs(num) > 180 && Math.abs(num) <= 180000000) {
        return num / 1_000_000;
    }
    return num;
}

function isValidLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180;
}

function extractStationCoordinates(station) {
    if (!station || typeof station !== "object") return null;
    // Transit API search responses can use lat/lon, latitude/longitude, x/y, or coord arrays [lon, lat].
    const nestedCoords = station.coord ?? station.location ?? null;

    const directLat = normalizeCoordinateNumber(station.lat ?? station.latitude ?? station.y);
    const directLon = normalizeCoordinateNumber(station.lon ?? station.longitude ?? station.lng ?? station.x);
    if (isValidLatLon(directLat, directLon)) {
        return { lat: directLat, lon: directLon };
    }

    if (Array.isArray(nestedCoords) && nestedCoords.length >= 2) {
        const lon = normalizeCoordinateNumber(nestedCoords[0]);
        const lat = normalizeCoordinateNumber(nestedCoords[1]);
        if (isValidLatLon(lat, lon)) {
            return { lat, lon };
        }
    }

    if (nestedCoords && typeof nestedCoords === "object") {
        const lat = normalizeCoordinateNumber(nestedCoords.lat ?? nestedCoords.latitude ?? nestedCoords.y);
        const lon = normalizeCoordinateNumber(nestedCoords.lon ?? nestedCoords.longitude ?? nestedCoords.lng ?? nestedCoords.x);
        if (isValidLatLon(lat, lon)) {
            return { lat, lon };
        }
    }

    return null;
}

// ------------------ SEARCH (BY NAME) ------------------

// ------------------ DEBUG FUNCTIONS ------------------

function closeDebugLogin() {
    document.getElementById("debugLoginPopup").style.display = "none";
    document.getElementById("debugLoginError").style.display = "none";
}

function canLeaveDevMode() {
    return !devModeEnabled;
}

function getDebugAuthHeader() {
    if (devModeEnabled) return "dev-mode";
    if (debugPassword) return debugPassword;
    return null;
}

function withDebugAuthHeaders(headers = {}) {
    const authHeader = getDebugAuthHeader();
    if (authHeader) {
        headers["X-Debug-Password"] = authHeader;
    }
    return withApiKey(headers);
}

function withApiKey(headers = {}) {
    if (window.APP_CONFIG && window.APP_CONFIG.apiKey) {
        headers["X-API-Key"] = window.APP_CONFIG.apiKey;
    }
    return headers;
}

function setLeaveDebugButtonVisible(isVisible) {
    const leaveBtn = document.getElementById("leaveDebugBtn");
    if (leaveBtn) leaveBtn.style.display = isVisible ? "block" : "none";
}

function enableDebugUI() {
    const updateBtn = document.getElementById("updateNowBtn");
    if (updateBtn) updateBtn.style.display = "block";
    const pauseBtn = document.getElementById("pauseUpdatesBtn");
    if (pauseBtn) pauseBtn.style.display = "block";
    const clearOverridesBtn = document.getElementById("clearOverridesBtn");
    if (clearOverridesBtn) clearOverridesBtn.style.display = "block";
    const resetAppDataBtn = document.getElementById("resetAppDataBtn");
    if (resetAppDataBtn) resetAppDataBtn.style.display = "block";
    setLeaveDebugButtonVisible(canLeaveDevMode());
    const devLocationBtn = document.getElementById("devLocationBtn");
    if (devLocationBtn) devLocationBtn.style.display = "block";

    updateExperimentalUI();
}

async function loginDebug() {
    const password = document.getElementById("debugPassword").value;
    try {
        DevLog.api('/debug/login', 'POST');
        const res = await fetch("/debug/login", {
            method: "POST",
            headers: withApiKey({ "Content-Type": "application/json" }),
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        DevLog.apiResponse('/debug/login', res.status, { success: data.success });
    if (data.success) {
        debugMode = true;
        debugPassword = password;
        localStorage.setItem(DEBUG_PASSWORD_KEY, password);
        DevLog.state('Debug mode enabled via login');
        closeDebugLogin();
        enableDebugUI();
        applyFilter(); // Re-render to show edit buttons

        // Track debug mode login
        if (typeof umami !== 'undefined') {
            umami.track('debug-login-success');
        }
    } else {
            document.getElementById("debugLoginError").textContent = data.error;
            document.getElementById("debugLoginError").style.display = "block";
            // Track debug login failure
            if (typeof umami !== 'undefined') {
                umami.track('debug-login-failed');
            }
        }
    } catch (e) {
        DevLog.error('API', 'Debug login failed', e);
        console.error(e);
    }
}

function logoutDebug() {
    if (devModeEnabled) {
        showError("Dev mode is enabled via environment variable. Unset DEV/dev or restart without them to disable it.");
        return;
    }

    debugMode = false;
    debugPassword = "";
    localStorage.removeItem(DEBUG_PASSWORD_KEY);
    DevLog.state('Debug mode disabled via logout');

    // Track debug mode logout
    if (typeof umami !== 'undefined') {
        umami.track('debug-logout');
    }

    // Hide debug buttons
    const updateBtn = document.getElementById("updateNowBtn");
    if (updateBtn) updateBtn.style.display = "none";
    const pauseBtn = document.getElementById("pauseUpdatesBtn");
    if (pauseBtn) pauseBtn.style.display = "none";
    const clearOverridesBtn = document.getElementById("clearOverridesBtn");
    if (clearOverridesBtn) clearOverridesBtn.style.display = "none";
    const resetAppDataBtn = document.getElementById("resetAppDataBtn");
    if (resetAppDataBtn) resetAppDataBtn.style.display = "none";
    setLeaveDebugButtonVisible(false);
    const devLocationBtn = document.getElementById("devLocationBtn");
    if (devLocationBtn) devLocationBtn.style.display = "none";

    updateExperimentalUI();

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

async function clearDebugOverrides() {
    if (!debugMode) return;
    const authHeader = getDebugAuthHeader();
    if (!authHeader) {
        showError("Debug authentication not available.");
        return;
    }
    if (!confirm("Clear all debug overrides?")) return;
    try {
        DevLog.api('/debug/clear', 'POST');
        const res = await fetch("/debug/clear", {
            method: "POST",
            headers: withApiKey({
                "X-Debug-Password": authHeader
            })
        });
        const data = await res.json();
        DevLog.apiResponse('/debug/clear', res.status, data);
        if (!res.ok || !data.success) {
            showError(data.error || "Failed to clear overrides.");
            return;
        }
        updateNow();
        if (typeof umami !== 'undefined') {
            umami.track('debug-clear-overrides');
        }
    } catch (e) {
        DevLog.error('API', 'Failed to clear debug overrides', e);
        console.error(e);
        showError("Failed to clear overrides.");
    }
}

function resetAppData() {
    if (!debugMode) return;
    if (!confirm("Reset ALL saved app data? This cannot be undone.")) return;
    DevLog.storage('Resetting all app data', { keys: APP_STORAGE_KEYS });
    APP_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    debugPassword = "";
    debugMode = devModeEnabled;
    if (typeof umami !== 'undefined') {
        umami.track('debug-reset-app-data');
    }
    window.location.reload();
}

// ------------------ EXPERIMENTAL FEATURES ------------------

function toggleExperimentalFeatures() {
    const isEnabled = document.getElementById("experimentalToggle").checked;
    localStorage.setItem(EXPERIMENTAL_KEY, isEnabled);

    // Track experimental features toggle
    if (typeof umami !== 'undefined') {
        umami.track('experimental-features-toggle', { enabled: isEnabled });
    }

    updateExperimentalUI();
}

function updateExperimentalUI() {
    const isEnabled = localStorage.getItem(EXPERIMENTAL_KEY) === "true";
    const mapBtn = document.getElementById("mapTabBtn");
    const locateMeBtn = document.getElementById("locateMeBtn");
    const devLocationBtn = document.getElementById("devLocationBtn");
    const toggle = document.getElementById("experimentalToggle");
    
    if (toggle) toggle.checked = isEnabled;
    
    if (mapBtn) {
        // If debugMode is on, it's always shown. Otherwise, depend on experimental toggle.
        if (debugMode || isEnabled) {
            mapBtn.style.display = "block";
        } else {
            mapBtn.style.display = "none";
            // If we are currently on the map tab and experimental is disabled (and not in debug), switch away
            if (document.getElementById("mapTab").classList.contains("active") && !debugMode) {
                switchTab('departures');
            }
        }
    }

    if (locateMeBtn) {
        locateMeBtn.style.display = (debugMode || isEnabled) ? "flex" : "none";
    }

    if (devLocationBtn) {
        devLocationBtn.style.display = debugMode ? "block" : "none";
    }
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

function getCurrentNotificationScrollDuration() {
    const notificationContent = document.querySelector(".notification-bar-content");
    if (!notificationContent) return null;
    const duration = parseFloat(getComputedStyle(notificationContent).animationDuration);
    return Number.isFinite(duration) ? duration : null;
}

function openNotificationEdit() {
    const popup = document.getElementById("notificationEditPopup");
    if (!popup) return;
    const heightInput = document.getElementById("notificationHeight");
    const textSizeInput = document.getElementById("notificationTextSize");
    const scrollInput = document.getElementById("notificationScrollDuration");
    const currentDuration = notificationSettings.scrollDuration ?? getCurrentNotificationScrollDuration();
    if (heightInput) heightInput.value = notificationSettings.heightPercent;
    if (textSizeInput) textSizeInput.value = notificationSettings.textSizePx;
    if (scrollInput) scrollInput.value = currentDuration ?? "";
    popup.style.display = "block";
}

function closeNotificationEdit() {
    const popup = document.getElementById("notificationEditPopup");
    if (popup) popup.style.display = "none";
}

function saveNotificationEdit() {
    const heightValue = Number(document.getElementById("notificationHeight").value);
    const textSizeValue = Number(document.getElementById("notificationTextSize").value);
    const scrollValue = Number(document.getElementById("notificationScrollDuration").value);
    notificationSettings.heightPercent = Number.isFinite(heightValue) && heightValue > 0
        ? heightValue
        : NOTIFICATION_SETTINGS_DEFAULTS.heightPercent;
    notificationSettings.textSizePx = Number.isFinite(textSizeValue) && textSizeValue > 0
        ? textSizeValue
        : NOTIFICATION_SETTINGS_DEFAULTS.textSizePx;
    notificationSettings.scrollDuration = Number.isFinite(scrollValue) && scrollValue > 0
        ? scrollValue
        : null;
    applyNotificationSizing();
    updateNotificationScrollDuration();
    closeNotificationEdit();
}

function resetNotificationEdit() {
    notificationSettings = { ...NOTIFICATION_SETTINGS_DEFAULTS };
    applyNotificationSizing();
    updateNotificationScrollDuration();
    closeNotificationEdit();
}

function applyNotificationSizing() {
    const notificationBar = document.getElementById("notificationBar");
    const notificationText = document.getElementById("notificationText");
    if (!notificationBar || !notificationText) return;
    if (notificationSettings.heightPercent !== NOTIFICATION_SETTINGS_DEFAULTS.heightPercent) {
        const scale = notificationSettings.heightPercent / 100;
        notificationBar.style.setProperty("--notification-padding-scale", scale.toString());
    } else {
        notificationBar.style.removeProperty("--notification-padding-scale");
    }
    if (notificationSettings.textSizePx !== NOTIFICATION_SETTINGS_DEFAULTS.textSizePx) {
        notificationText.style.fontSize = `${notificationSettings.textSizePx}px`;
    } else {
        notificationText.style.fontSize = "";
    }
}

function updateNotificationScrollDuration(textLength = null) {
    const notificationContent = document.querySelector(".notification-bar-content");
    if (!notificationContent) return null;
    const notificationText = document.getElementById("notificationText");
    const resolvedLength = Number.isFinite(textLength)
        ? textLength
        : (notificationText?.textContent?.length || 0);
    const baseDuration = Math.max(15, resolvedLength * 0.3);
    const duration = notificationSettings.scrollDuration ?? baseDuration;
    notificationContent.style.animationDuration = `${duration}s`;
    return duration;
}

function openDevLocation() {
    const popup = document.getElementById("devLocationPopup");
    const error = document.getElementById("devLocationError");
    const coords = getDevLocationOverride();
    if (error) error.style.display = "none";

    if (coords) {
        document.getElementById("devLatitude").value = coords.latitude;
        document.getElementById("devLongitude").value = coords.longitude;
    } else {
        document.getElementById("devLatitude").value = "";
        document.getElementById("devLongitude").value = "";
    }

    if (popup) popup.style.display = "block";
}

function closeDevLocation() {
    const popup = document.getElementById("devLocationPopup");
    if (popup) popup.style.display = "none";
}

function getDevLocationOverride() {
    const stored = localStorage.getItem(DEV_LOCATION_KEY);
    if (!stored) return null;
    try {
        const data = JSON.parse(stored);
        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return { latitude, longitude };
    } catch (e) {
        return null;
    }
}

function saveDevLocation() {
    const error = document.getElementById("devLocationError");
    const latitude = Number(document.getElementById("devLatitude").value);
    const longitude = Number(document.getElementById("devLongitude").value);

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        if (error) {
            error.textContent = "Please enter valid latitude and longitude values.";
            error.style.display = "block";
        }
        return;
    }

    localStorage.setItem(DEV_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
    if (error) error.style.display = "none";
    closeDevLocation();
}

function clearDevLocation() {
    localStorage.removeItem(DEV_LOCATION_KEY);
    document.getElementById("devLatitude").value = "";
    document.getElementById("devLongitude").value = "";
    const error = document.getElementById("devLocationError");
    if (error) error.style.display = "none";
    closeDevLocation();
}

async function saveDebugOverride() {
    const stop_id = document.getElementById("editStopId").value;
    const line = document.getElementById("editLine").value;
    const direction = document.getElementById("editDirection").value;
    const stable_scheduled_time = document.getElementById("editStableScheduledTime").value;
    const minutes = document.getElementById("editMinutes").value;
    const delay = document.getElementById("editDelay").value;

    try {
        const payload = {
            stop_id,
            line,
            direction,
            stable_scheduled_time,
            minutes_remaining: minutes,
            delay: delay
        };
        DevLog.api('/debug/update', 'POST', payload);
        const res = await fetch("/debug/update", {
            method: "POST",
            headers: withDebugAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        DevLog.apiResponse('/debug/update', res.status, result);
        console.log("Debug update response:", result);

        // Track debug override save
        if (typeof umami !== 'undefined') {
            umami.track('debug-override-save', { line: line });
        }

        closeDebugEdit();
        refreshDepartures(); // Refresh data to see changes
    } catch (e) {
        DevLog.error('API', 'Failed to save debug override', e);
        console.error(e);
    }
}

async function clearDebugOverride() {
    const stop_id = document.getElementById("editStopId").value;
    const line = document.getElementById("editLine").value;
    const direction = document.getElementById("editDirection").value;
    const stable_scheduled_time = document.getElementById("editStableScheduledTime").value;

    try {
        const payload = {
            stop_id,
            line,
            direction,
            stable_scheduled_time
            // No overrides provided means clear
        };
        DevLog.api('/debug/update (clear)', 'POST', payload);
        const res = await fetch("/debug/update", {
            method: "POST",
            headers: withDebugAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        DevLog.apiResponse('/debug/update (clear)', res.status, data);
        console.log("Debug clear response:", data);
        closeDebugEdit();
        refreshDepartures();
    } catch (e) {
        DevLog.error('API', 'Failed to clear debug override', e);
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

    // Track search event
    if (typeof umami !== 'undefined') {
        umami.track('station-search', { method: 'by-name', station: inputName });
    }

    // Reset filters when searching a new station
    document.getElementById("lineFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("wheelchairFilter").checked = false;

    document.getElementById("stationHeader").innerText = inputName;

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

    // Track quick search
    if (typeof umami !== 'undefined') {
        umami.track('quick-search-button', { station: station });
    }

    searchStop();
}

// ------------------ QUICK SEARCH (BY ID) ------------------

function quickSearchById(id, displayName, options = {}) {
    const { resetFilters = true, skipDisplayUpdate = false } = options;
    const resolvedName = typeof displayName === "string" ? displayName.trim() : "";
    stopId = id;
    stopName = resolvedName;

    if (skipDisplayUpdate) {
        document.getElementById("stopInput").value = "";
        document.getElementById("stationHeader").innerText = "";
    } else {
        document.getElementById("stopInput").value = resolvedName;
        document.getElementById("stationHeader").innerText = resolvedName;
    }
    toggleClearButton();

    // Track search by ID
    if (typeof umami !== 'undefined') {
        umami.track('station-search', { method: 'by-id', station: resolvedName || id, stopId: id });
    }

    // Reset filters when searching a new station
    if (resetFilters) {
        document.getElementById("lineFilter").value = "";
        document.getElementById("typeFilter").value = "";
        document.getElementById("wheelchairFilter").checked = false;
    }

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

    // Track pause/resume updates
    if (typeof umami !== 'undefined') {
        umami.track('debug-toggle-pause', { paused: updatesPaused });
    }

    if (!updatesPaused) {
        countdown = 30;
        refreshDepartures();
    }
    updateCountdown();
}

function updateNow() {
    // Track update now button
    if (typeof umami !== 'undefined') {
        umami.track('debug-update-now');
    }

    countdown = 30;
    refreshDepartures(true);
}

// ------------------ FETCH (BY NAME) ------------------

async function fetchDepartures(ignorePaused = false, isUserSearch = false) {
    if (updatesPaused && !ignorePaused) return;
    showSkeletonLoading();
    closeError();
    
    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }

    if (isUserSearch) {
        searchTimeout = setTimeout(() => {
            showError("Search timed out, try again.");
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

        DevLog.api('/search', 'GET', { stop: lookupName });
        const res = await fetch(`/search?stop=${encodeURIComponent(lookupName)}`, {
            headers: withApiKey()
        });
        const result = await res.json();
        DevLog.apiResponse('/search', res.status, { departures: result.departures?.length || 0, station: result.station_name });

        if (res.status === 404) {
            if (searchTimeout) {
                clearTimeout(searchTimeout);
                searchTimeout = null;
            }
            showError("Station not found");
            // Track search failure
            if (typeof umami !== 'undefined') {
                umami.track('search-failed', { station: lookupName, reason: 'not-found' });
            }
            return;
        }

        if (result.error) {
            console.error(result.error);
            // Track search error
            if (typeof umami !== 'undefined') {
                umami.track('search-failed', { station: lookupName, reason: 'error' });
            }
            return;
        }

        if (searchTimeout) {
            clearTimeout(searchTimeout);
            searchTimeout = null;
        }

        const fullStationName = result.station_name;

        // Track successful search
        if (typeof umami !== 'undefined') {
            umami.track('search-success', { station: fullStationName });
        }

        if (result.info) {
            showError(result.info);
            // Auto-close info after 5 seconds since it's not a critical error
            setTimeout(closeError, 5000);
        }

        // Store the full station name and ID from API
        stopName = fullStationName;
        document.getElementById("stopInput").value = fullStationName;
        document.getElementById("stationHeader").innerText = fullStationName;
        document.title = `${fullStationName} - Transit Live Departures`;
        toggleClearButton();
        if (result.departures.length > 0) {
            stopId = result.departures[0].stop_id;
        }

        // Fetch notifications for this stop
        if (Array.isArray(result.notifications)) {
            if (result.notifications.length > 0) {
                displayNotifications(result.notifications);
            } else {
                hideNotificationBar();
            }
        } else {
            fetchNotifications(stopId);
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
        syncUrlFromState(!isUserSearch);
    } catch (e) {
        console.error(e);
    } finally {
        hideSkeletonLoading();
    }
}

// ------------------ FETCH (BY ID) ------------------

async function fetchDeparturesById(ignorePaused = false, isUserSearch = false) {
    if (updatesPaused && !ignorePaused) return;
    showSkeletonLoading();
    closeError();

    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }

    if (isUserSearch) {
        searchTimeout = setTimeout(() => {
            showError("Search timed out, try again.");
        }, 10000);
        // Clear the grid so we don't see old departures if a search fails
        document.getElementById("departuresGrid").innerHTML = "";
    }

    try {
        DevLog.api('/search_by_id', 'GET', { stop_id: stopId, station_name: stopName });
        const res = await fetch(`/search_by_id?stop_id=${stopId}&station_name=${encodeURIComponent(stopName)}`, {
            headers: withApiKey()
        });
        const result = await res.json();
        DevLog.apiResponse('/search_by_id', res.status, { departures: result.departures?.length || 0, station: result.station_name });

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
        document.getElementById("stopInput").value = result.station_name;
        toggleClearButton();
        document.title = `${result.station_name} - Transit Live Departures`;
        stopName = result.station_name;

        // Fetch notifications for this stop
        if (Array.isArray(result.notifications)) {
            if (result.notifications.length > 0) {
                displayNotifications(result.notifications);
            } else {
                hideNotificationBar();
            }
        } else {
            fetchNotifications(stopId);
        }

        lastDepartures = result.departures;
        applyFilter();
        countdown = 30;
        updateFavoriteButton();
        updateHomeButton();
        syncUrlFromState(!isUserSearch);
    } catch (e) {
        console.error(e);
    } finally {
        hideSkeletonLoading();
    }
}

// ------------------ NOTIFICATION BAR ------------------

let currentNotifications = [];

function getPriorityEmoji(priority) {
    switch ((priority || '').toLowerCase()) {
        case 'verylow':  return 'ℹ️';
        case 'low':      return '⚠️';
        case 'normal':   return '⚠️';
        case 'high':     return '🔴';
        case 'veryhigh': return '🚨';
        default:         return '⚠️';
    }
}

function sanitizeNotificationHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ALLOWED_TAGS = new Set(['B', 'I', 'STRONG', 'EM', 'BR']);
    function clean(node) {
        const children = Array.from(node.childNodes);
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) continue;
            if (child.nodeType === Node.ELEMENT_NODE && ALLOWED_TAGS.has(child.tagName)) {
                clean(child);
            } else {
                child.replaceWith(document.createTextNode(child.textContent));
            }
        }
    }
    clean(doc.body);
    return doc.body.innerHTML;
}

async function fetchNotifications(stopIdParam) {
    if (!stopIdParam) {
        DevLog.notification('Skipped fetch - no stopId provided');
        hideNotificationBar();
        return;
    }
    
    try {
        const apiUrl = `${notificationApiBaseUrl}/current_notifs?stopID=${encodeURIComponent(stopIdParam)}`;
        DevLog.api(apiUrl, 'GET', { stopID: stopIdParam });
        const response = await fetch(apiUrl);
        DevLog.apiResponse('current_notifs', response.status);
        if (!response.ok) {
            DevLog.notification('Fetch failed - response not ok', { status: response.status });
            hideNotificationBar();
            return;
        }
        
        const notifications = await response.json();
        DevLog.notification('Fetched notifications', { count: notifications?.length || 0, notifications });
        
        if (Array.isArray(notifications) && notifications.length > 0) {
            displayNotifications(notifications);
        } else {
            hideNotificationBar();
        }
    } catch (e) {
        DevLog.error('NOTIFICATION', 'Error fetching notifications', e);
        console.error("Error fetching notifications:", e);
        hideNotificationBar();
    }
}

function displayNotifications(notifications) {
    const notificationBar = document.getElementById("notificationBar");
    const notificationText = document.getElementById("notificationText");
    const notificationContent = notificationBar?.querySelector(".notification-bar-content");
    
    if (!notificationBar || !notificationText || !notificationContent) return;
    
    // Store notifications for the detail popup
    currentNotifications = notifications;
    
    // Build scrolling text from subtitle (object format) or plain string
    const text = notifications.map(n => (typeof n === 'object' && n.subtitle) ? n.subtitle : String(n)).join("  •  ");
    notificationText.textContent = text;
    
    notificationBar.style.display = "block";
    notificationBar.onclick = function(event) {
        event.stopPropagation();
        openNotificationDetail();
    };
    
    // Adjust animation duration based on text length
    const textLength = text.length;
    applyNotificationSizing();
    const duration = updateNotificationScrollDuration(textLength);
    DevLog.notification('Displayed notifications', { count: notifications.length, textLength, animationDuration: duration ? `${duration}s` : null });
}

function openNotificationDetail() {
    const popup = document.getElementById("notificationDetailPopup");
    const body = document.getElementById("notificationDetailBody");
    if (!popup || !body || currentNotifications.length === 0) {
        DevLog.notification('Detail popup not opened - no notifications stored');
        return;
    }
    
    body.innerHTML = '';
    
    currentNotifications.forEach((n, i) => {
        if (typeof n !== 'object') return;
        
        const item = document.createElement('div');
        item.className = 'notification-detail-item';
        
        const emoji = getPriorityEmoji(n.priority);
        
        const title = document.createElement('div');
        title.className = 'notification-detail-title';
        title.textContent = `${emoji} ${n.subtitle || ''}`;
        item.appendChild(title);
        
        if (n.content) {
            const content = document.createElement('div');
            content.className = 'notification-detail-content';
            content.innerHTML = sanitizeNotificationHtml(n.content);
            item.appendChild(content);
        }
        
        if (n.providerCode) {
            const provider = document.createElement('div');
            provider.className = 'notification-detail-provider';
            provider.textContent = n.providerCode;
            item.appendChild(provider);
        }
        
        body.appendChild(item);
        
        // Add separator between items
        if (i < currentNotifications.length - 1) {
            const sep = document.createElement('hr');
            sep.className = 'notification-detail-separator';
            body.appendChild(sep);
        }
    });
    
    popup.style.display = "block";
}

function closeNotificationDetail() {
    const popup = document.getElementById("notificationDetailPopup");
    if (popup) popup.style.display = "none";
}

function hideNotificationBar() {
    const notificationBar = document.getElementById("notificationBar");
    if (notificationBar) {
        notificationBar.style.display = "none";
        DevLog.notification('Hidden notification bar');
    }
}

// ------------------ LINE ICON ------------------

function getLineIcon(mot) {
    const m = parseInt(mot);
    switch(m) {
        case 0: // train
        case 13: // regional train
        case 14: // national train
        case 15: // international train
        case 16: // high-speed train
            return `<img src="/static/icons/db.png" class="line-icon">`;
        case 1: // commuter railway (S-Bahn)
            return `<img src="/static/icons/sbahn.png" class="line-icon">`;
        case 2: // underground train
            return `<img src="/static/icons/ubahn.png" class="line-icon">`;
        case 3: // city rail
            return `<img src="/static/icons/stadtbahn.png" class="line-icon">`;
        case 4: // tram
            return `<img src="/static/icons/tram.png" class="line-icon">`;
        case 5: // city bus
        case 6: // regional bus
        case 10: // transit on demand
        case 19: // Bürgerbus
            return `<img src="/static/icons/bus.png" class="line-icon">`;
        case 7: // coach
            return `<img src="/static/icons/farbus.png" class="line-icon">`;
        case 17: // rail replacement train
            return `<img src="/static/icons/bus.png" class="line-icon">`; // Or separate icon if available
        case 18: // shuttle train
            return `<img src="/static/icons/db.png" class="line-icon">`;
        case 8: // cable car
            return `<img src="/static/icons/tram.png" class="line-icon">`;
        case 9: // boat / ferry
            return `<img src="/static/icons/ferry.png" class="line-icon">`;
        default:
            return `<img src="/static/icons/missing.png" class="line-icon">`;
    }
}

// ------------------ FILTERING ------------------

function applyFilter() {
    const lineFilter = document.getElementById("lineFilter").value.trim();
    const typeFilter = document.getElementById("typeFilter").value;
    const wheelchairFilter = document.getElementById("wheelchairFilter").checked;

    DevLog.filter('Applying filters', { line: lineFilter || '(none)', type: typeFilter || '(all)', wheelchair: wheelchairFilter });

    // Track filter usage
    if (typeof umami !== 'undefined') {
        if (lineFilter) {
            umami.track('filter-line', { line: lineFilter });
        }
        if (typeFilter) {
            umami.track('filter-type', { type: typeFilter });
        }
        if (wheelchairFilter) {
            umami.track('filter-wheelchair');
        }
    }

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
            const mot = parseInt(d.mot);
            if (typeFilter === "s") typeMatch = (mot === 1);
            else if (typeFilter === "stadtbahn") typeMatch = (mot === 3);
            else if (typeFilter === "tram") typeMatch = (mot === 4);
            else if (typeFilter === "bus") typeMatch = [5, 6, 10, 19].includes(mot);
            else if (typeFilter === "farbus") typeMatch = (mot === 7);
            else if (typeFilter === "ferry") typeMatch = (mot === 9);
            else if (typeFilter === "train") typeMatch = [0, 13, 14, 15, 16, 17, 18].includes(mot);
        }

        // Wheelchair filter
        if (wheelchairFilter) {
            wheelchairMatch = d.wheelchair_accessible === true;
        }

        return lineMatch && typeMatch && wheelchairMatch;
    });

    populateTable(filtered);
    syncUrlFromState(true);
}

// ------------------ TABLE ------------------

function showSkeletonLoading() {
    const grid = document.getElementById("skeletonGrid");
    grid.innerHTML = "";
    const platformCount = 3;
    const cardsPerPlatform = 4;
    for (let p = 0; p < platformCount; p++) {
        const col = document.createElement("div");
        col.className = "skeleton-platform-column";
        let html = `
            <div class="skeleton-platform-header">
                <div class="skeleton-bone skeleton-platform-title"></div>
                <div class="skeleton-bone skeleton-platform-icon"></div>
            </div>
        `;
        for (let c = 0; c < cardsPerPlatform; c++) {
            html += `
                <div class="skeleton-card">
                    <div class="skeleton-line-info">
                        <div class="skeleton-bone skeleton-line-icon"></div>
                        <div class="skeleton-line-content">
                            <div class="skeleton-bone skeleton-line-number"></div>
                            <div class="skeleton-bone skeleton-direction"></div>
                        </div>
                    </div>
                    <div class="skeleton-time-section">
                        <div class="skeleton-bone skeleton-departure-time"></div>
                        <div class="skeleton-bone skeleton-realtime-badge"></div>
                    </div>
                </div>
            `;
        }
        col.innerHTML = html;
        grid.appendChild(col);
    }
    document.getElementById("loading").style.display = "block";
}

function hideSkeletonLoading() {
    document.getElementById("loading").style.display = "none";
}

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
            const type = getServiceType(d.mot);
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

                const iconHtml = getLineIcon(d.mot);
                const realtimeBadge = d.is_realtime
                    ? '<div class="realtime-badge">Real-time</div>'
                    : '';

                // Display "Arriving Now" for 0-1 minutes
                const departureDisplay = d.minutes_remaining <= 1
                    ? 'Arriving Now'
                    : d.departure_display;

                let timeHtml = `<div class="departure-time">${departureDisplay}</div>`;
                if (d.delay > 1) {
                    const scheduledDisplay = d.minutes_remaining - d.delay <= 1 
                        ? 'Arriving Now' 
                        : d.scheduled_display;
                    timeHtml = `
                        <div class="departure-time">
                            <span class="scheduled-time-strikethrough">${scheduledDisplay}</span>
                            <span class="estimated-time-delayed">${departureDisplay}</span>
                        </div>
                    `;
                }

                const delayInfo = d.delay > 0 
                    ? `<div class="delay-info" style="color: red; font-size: 12px; font-weight: 600;">+${d.delay}<span class="unit">min</span> Delay</div>`
                    : '';

                const wheelchairIcon = d.wheelchair_accessible === true || d.wheelchair_accessible === "true"
                    ? '<span class="departure-wheelchair-icon">♿</span>'
                    : '';

                const debugEditBtn = debugMode
                    ? `<button class="debug-edit-btn" data-stop-id="${escapeHtml(d.stop_id)}" data-line="${escapeHtml(d.line)}" data-direction="${escapeHtml(d.direction)}" data-scheduled-time="${escapeHtml(d.stable_scheduled_time)}" data-minutes="${parseInt(d.minutes_remaining) || 0}" data-delay="${parseInt(d.delay) || 0}">✎</button>`
                    : '';

                card.innerHTML = `
                    <div class="line-info">
                        <div class="line-icon">${iconHtml}</div>
                        <div style="flex-grow: 1;">
                            <div class="line-number" style="color: ${escapeHtml(d.color)};">${escapeHtml(d.line)}${wheelchairIcon}${debugEditBtn}</div>
                            <div class="direction">${escapeHtml(d.direction)}</div>
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

                // Attach debug edit handler via addEventListener instead of inline onclick
                const editBtn = card.querySelector('.debug-edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', function(event) {
                        event.stopPropagation();
                        openDebugEdit(
                            this.dataset.stopId,
                            this.dataset.line,
                            this.dataset.direction,
                            this.dataset.scheduledTime,
                            parseInt(this.dataset.minutes) || 0,
                            parseInt(this.dataset.delay) || 0
                        );
                    });
                }

                platformColumn.appendChild(card);
            });

        grid.appendChild(platformColumn);
    });
}

// Helper function to determine service type
function getServiceType(mot) {
    const m = parseInt(mot);
    switch(m) {
        case 1:
            return "sbahn";
        case 2:
            return "ubahn";
        case 3:
            return "stadtbahn";
        case 4:
            return "tram";
        case 5:
        case 6:
        case 10:
        case 19:
            return "bus";
        case 7:
            return "farbus";
        case 9:
            return "ferry";
        case 0:
        case 13:
        case 14:
        case 15:
        case 16:
        case 17:
        case 18:
            return "db";
        default:
            return "other";
    }
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
    const stationPopup = document.getElementById("stationSelectPopup");

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

    const notificationEditPopup = document.getElementById("notificationEditPopup");
    if (notificationEditPopup &&
        notificationEditPopup.style.display === "block" &&
        !notificationEditPopup.querySelector(".modal-content").contains(event.target)) {
        notificationEditPopup.style.display = "none";
    }

    const notificationDetailPopup = document.getElementById("notificationDetailPopup");
    if (notificationDetailPopup &&
        notificationDetailPopup.style.display === "block" &&
        !notificationDetailPopup.querySelector(".modal-content").contains(event.target)) {
        notificationDetailPopup.style.display = "none";
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

    // Track station switch from dropdown
    if (typeof umami !== 'undefined') {
        umami.track('station-dropdown-switch', { station: selected.name });
    }

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
            <strong>${escapeHtml(station.name)}</strong><br>
            <small>ID: ${escapeHtml(station.id)}</small>
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
    const stopInput = document.getElementById("stopInput");
    const cityInput = document.getElementById("cityInput");
    if (stopInput) {
        stopInput.value = "";
        toggleClearButton();
    }
    if (cityInput) {
        cityInput.value = "";
    }
    if (stopInput) {
        stopInput.focus();
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

function isFavorite(id) {
    return getFavorites().some(fav => fav.id === id);
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
    const index = favorites.findIndex(fav => fav.id === stopId);

    if (index > -1) {
        // Remove from favorites
        favorites.splice(index, 1);
        DevLog.storage('Removed from favorites', { id: stopId, name: stopName });
        // Track favorite removal
        if (typeof umami !== 'undefined') {
            umami.track('favorite-remove', { station: stopName });
        }
    } else {
        // Add to favorites with full station name and ID from API
        favorites.push({
            id: stopId,
            name: stopName
        });
        DevLog.storage('Added to favorites', { id: stopId, name: stopName });
        // Track favorite addition
        if (typeof umami !== 'undefined') {
            umami.track('favorite-add', { station: stopName });
        }
    }

    saveFavorites(favorites);
    updateFavoriteButton();
    updateFavoritesDisplay();
}

function updateFavoriteButton() {
    const btn = document.getElementById('favoriteBtn');
    const isFav = isFavorite(stopId);

    if (isFav) {
        btn.classList.add('favorite-active');
        btn.setAttribute('title', 'Remove from favorites');
    } else {
        btn.classList.remove('favorite-active');
        btn.setAttribute('title', 'Add to favorites');
    }
}

let favoritesEditMode = false;
let favoritesCollapsed = localStorage.getItem(FAVORITES_COLLAPSED_KEY) === 'true';

function toggleFavoritesEditMode() {
    favoritesEditMode = !favoritesEditMode;
    updateFavoritesDisplay();
}

function toggleFavoritesCollapsed() {
    favoritesCollapsed = !favoritesCollapsed;
    localStorage.setItem(FAVORITES_COLLAPSED_KEY, favoritesCollapsed);
    if (favoritesCollapsed) {
        favoritesEditMode = false;
    }
    updateFavoritesDisplay();
}

function updateFavoritesDisplay() {
    const favorites = getFavorites();
    const section = document.getElementById('favoritesSection');
    const grid = document.getElementById('favoritesGrid');
    const chevron = document.getElementById('favoritesChevron');
    const menuBtn = document.getElementById('favoritesMenuBtn');

    if (favorites.length === 0) {
        favoritesEditMode = false;
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Update collapse state
    const header = section.querySelector('.favorites-header');
    if (chevron) {
        chevron.classList.toggle('collapsed', favoritesCollapsed);
    }
    if (header) {
        header.classList.toggle('collapsed', favoritesCollapsed);
    }
    if (favoritesCollapsed) {
        grid.style.display = 'none';
        if (menuBtn) menuBtn.style.display = 'none';
        return;
    }

    grid.style.display = '';
    if (menuBtn) menuBtn.style.display = '';
    grid.innerHTML = '';

    // Update the three-dot menu button state
    if (menuBtn) {
        menuBtn.classList.toggle('active', favoritesEditMode);
    }

    favorites.forEach((fav, index) => {
        const btnWrapper = document.createElement('div');
        btnWrapper.className = 'favorite-btn-wrapper';

        const btn = document.createElement('button');
        btn.className = 'favorite-quick-btn';
        btn.innerText = fav.name;
        btn.title = fav.name;

        if (favoritesEditMode) {
            btn.classList.add('favorite-edit-mode');
            btn.style.paddingRight = '35px';
        }

        btn.onclick = () => {
            if (favoritesEditMode) return;
            // Track favorite quick button click
            if (typeof umami !== 'undefined') {
                umami.track('favorite-quick-button', { station: fav.name });
            }
            quickSearchById(fav.id, fav.name);
        };

        btnWrapper.appendChild(btn);

        if (favoritesEditMode) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-favorite-x';
            removeBtn.innerHTML = '×';
            removeBtn.title = 'Remove from favorites';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeFavorite(index);
            };
            btnWrapper.appendChild(removeBtn);
        }

        grid.appendChild(btnWrapper);
    });
}

function removeFavorite(index) {
    const favorites = getFavorites();
    const removedStation = favorites[index];
    favorites.splice(index, 1);
    saveFavorites(favorites);

    // Track favorite removal via X button
    if (typeof umami !== 'undefined' && removedStation) {
        umami.track('favorite-remove-x-button', { station: removedStation.name });
    }

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
        DevLog.storage('Unset home station', { id: stopId, name: cleanedName });
        // Track home station unset
        if (typeof umami !== 'undefined') {
            umami.track('home-station-unset', { station: cleanedName });
        }
    } else {
        localStorage.setItem(HOME_STATION_KEY, JSON.stringify({
            id: stopId,
            name: cleanedName
        }));
        DevLog.storage('Set home station', { id: stopId, name: cleanedName });
        // Track home station set
        if (typeof umami !== 'undefined') {
            umami.track('home-station-set', { station: cleanedName });
        }
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
    DevLog.ui('Tab switch', { to: tabId });
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === tabId);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId + 'Tab');
    });

    // Track tab switch
    if (typeof umami !== 'undefined') {
        umami.track('tab-switch', { tab: tabId });
    }

    if (tabId === 'map') {
        initMap();
    }
    syncUrlFromState();
}

function initMap() {
    if (map) {
        DevLog.map('Map already initialized, invalidating size');
        setTimeout(() => map.invalidateSize(), 100);
        return;
    }

    DevLog.map('Initializing map', { center: [49.0069, 8.4037], zoom: 13 });
    // Centered on Karlsruhe: 49.0069, 8.4037
    map = L.map('map').setView([49.0069, 8.4037], 13);

    // Standard OSM base layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // ÖPNV Karte (Transit Layer)
    // This layer highlights tram tracks and bus lines
    L.tileLayer('https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png', {
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

    map.on('popupclose', () => {
        if (!isRefreshingMapMarkers) {
            openMapPopupName = null;
        }
    });

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

function getMapLookupCoordinates(markerCoords) {
    if (markerCoords && Number.isFinite(markerCoords.lat) && Number.isFinite(markerCoords.lon)) {
        return { lat: markerCoords.lat, lon: markerCoords.lon };
    }
    if (map && typeof map.getCenter === "function") {
        const center = map.getCenter();
        return { lat: center.lat, lon: center.lng };
    }
    return null;
}

function getMapCityUserAgent() {
    const metaTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content;
    const appTitle = (metaTitle || document.title || "Transit Tracker Webapp").trim();
    const origin = window.location?.origin || window.location?.href || "unknown-origin";
    return `${appTitle} (${origin})`;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roundCoordinate(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

function getCityFromAddress(address = {}) {
    if (!address || typeof address !== "object") return "";
    return [
        address.city,
        address.town,
        address.village,
        address.municipality,
        address.county,
        address.state
    ].find(value => value && String(value).trim()) || "";
}

async function resolveMapCityName(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    const cacheLat = roundCoordinate(lat, MAP_CITY_CACHE_PRECISION);
    const cacheLon = roundCoordinate(lon, MAP_CITY_CACHE_PRECISION);
    const cacheKey = `${cacheLat.toFixed(MAP_CITY_CACHE_PRECISION)},${cacheLon.toFixed(MAP_CITY_CACHE_PRECISION)}`;
    const cached = MAP_CITY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < MAP_CITY_CACHE_TTL_MS) {
        return cached.city;
    }

    const requestTask = async () => {
        const elapsed = Date.now() - mapCityLastRequestAt;
        const waitMs = Math.max(0, MAP_CITY_MIN_REQUEST_INTERVAL_MS - elapsed);
        if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
        mapCityLastRequestAt = Date.now();

        try {
            const params = new URLSearchParams({
                format: "json",
                lat: String(lat),
                lon: String(lon),
                zoom: "10",
                addressdetails: "1"
            });
            DevLog.map('Nominatim reverse geocode', { lat, lon, cacheKey });
            const response = await fetch(`${MAP_CITY_NOMINATIM_URL}?${params.toString()}`, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": getMapCityUserAgent()
                }
            });
            DevLog.apiResponse('Nominatim', response.status);
            if (!response.ok) {
                const statusText = response.statusText ? ` ${response.statusText}` : "";
                throw new Error(`Reverse geocode failed: ${response.status}${statusText}`);
            }
            const data = await response.json();
            const city = getCityFromAddress(data.address);
            DevLog.map('Nominatim resolved city', { city, address: data.address });
            if (city) {
                MAP_CITY_CACHE.set(cacheKey, { city, timestamp: Date.now() });
            }
            mapCityFailureCount = 0;
            return city;
        } catch (error) {
            DevLog.error('MAP', 'Error resolving map city name', error);
            console.error("Error resolving map city name:", error);
            mapCityFailureCount += 1;
            if (mapCityFailureCount >= MAP_CITY_FAILURE_WARN_THRESHOLD) {
                console.warn("Map city lookup failures are persisting. Check Nominatim availability or coordinates.");
            }
            return "";
        }
    };

    // Keep requests serialized even when earlier lookups fail.
    const requestPromise = mapCityRequestChain.then(
        () => requestTask(),
        () => requestTask()
    );
    mapCityRequestChain = requestPromise.catch((error) => {
        console.error("Map city lookup queue error:", error);
        // Keep the queue alive for future lookups even if one request fails.
        return "";
    });
    return requestPromise;
}

function appendCityToStopName(stationName, cityName) {
    const baseName = stationName ? stationName.trim() : "";
    if (!baseName || !cityName) return baseName;
    const normalizedCity = cityName.trim();
    const cityPattern = new RegExp(`\\b${escapeRegex(normalizedCity)}\\b`, "i");
    if (cityPattern.test(baseName)) return baseName;
    return `${baseName} ${cityName}`.trim();
}

// Populate the city input only when empty so manual entries are not overridden by map lookups.
function applyMapCityInput(cityName) {
    if (!cityName) return;
    const cityInput = document.getElementById("cityInput");
    if (cityInput && !cityInput.value.trim()) {
        cityInput.value = cityName;
    }
}

// Build a station lookup name with city context for map-driven searches.
async function resolveMapSearchContext(stationName, markerCoords = null) {
    const baseName = stationName ? stationName.trim() : "";
    if (!baseName) return { lookupName: baseName, cityName: "" };
    const coords = getMapLookupCoordinates(markerCoords);
    if (!coords) return { lookupName: baseName, cityName: "" };
    const cityName = await resolveMapCityName(coords.lat, coords.lon);
    return { lookupName: appendCityToStopName(baseName, cityName), cityName };
}

async function lookupStopByCoords(lat, lon) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        DevLog.api('/lookup_stop_by_coords', 'GET', { lat, lon });
        const res = await fetch(`/lookup_stop_by_coords?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
            signal: controller.signal,
            headers: withApiKey()
        });
        const result = await res.json();
        DevLog.apiResponse('/lookup_stop_by_coords', res.status, result);
        if (!res.ok || result.error) {
            throw new Error(result.error || "Failed to find nearby stop.");
        }
        return result;
    } catch (error) {
        if (error.name === "AbortError") {
            DevLog.error('API', 'Stop lookup timed out', { lat, lon });
            throw new Error("Stop lookup timed out.");
        }
        if (error instanceof TypeError) {
            DevLog.error('API', 'Network error in stop lookup', error);
            throw new Error(`Network error while contacting the server: ${error.message}`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildMapPopupDeparturesHtml(departures) {
    if (!departures || departures.length === 0) {
        return '<div class="map-popup-empty">No departures found.</div>';
    }

    const platforms = {};
    departures.forEach(d => {
        const platformKey = d.platform ? String(d.platform).trim() : "Unknown";
        if (!platforms[platformKey]) {
            platforms[platformKey] = [];
        }
        platforms[platformKey].push(d);
    });

    const sortedPlatforms = Object.keys(platforms).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b);
    });

    const showToggle = sortedPlatforms.length > 2;
    return sortedPlatforms.map((platform, index) => {
        const platformDepartures = platforms[platform];
        const departuresByLine = new Map();
        platformDepartures.forEach(d => {
            const existing = departuresByLine.get(d.line);
            if (!existing || d.minutes_remaining < existing.minutes_remaining) {
                departuresByLine.set(d.line, d);
            }
        });
        const departuresForPlatform = Array.from(departuresByLine.values())
            .sort((a, b) => a.minutes_remaining - b.minutes_remaining)
            .slice(0, 4);
        const serviceTypes = new Set(platformDepartures.map(d => getServiceType(d.mot)));
        const iconsHtml = Array.from(serviceTypes).map(type => (
            `<img src="/static/icons/${escapeHtml(type)}.png" class="platform-service-icon" title="${escapeHtml(type)}">`
        )).join('');

        const rowsHtml = departuresForPlatform.map(d => {
            const iconHtml = getLineIcon(d.mot);
            const departureDisplay = d.minutes_remaining <= 1 ? 'Arriving Now' : d.departure_display;
            return `
                <div class="map-popup-departure">
                    <div class="line-info">
                        <div class="line-icon">${iconHtml}</div>
                        <div class="map-popup-line">
                            <div class="line-number" style="color: ${escapeHtml(d.color)};">${escapeHtml(d.line)}</div>
                            <div class="direction">${escapeHtml(d.direction)}</div>
                        </div>
                    </div>
                    <div class="map-popup-time">${departureDisplay}</div>
                </div>
            `;
        }).join('');

        if (!showToggle) {
            return `
                <div class="map-popup-platform">
                    <div class="map-popup-platform-header">
                        <div class="map-popup-platform-title">
                            <span class="platform-label">Platform ${escapeHtml(platform)}</span>
                            <div class="map-popup-platform-icons">${iconsHtml}</div>
                        </div>
                    </div>
                    ${rowsHtml}
                </div>
            `;
        }

        const platformKey = escapeHtml(String(platform));
        const isOpen = index === 0;
        return `
            <div class="map-popup-platform">
                <button class="map-popup-platform-toggle" data-platform="${platformKey}" aria-expanded="${isOpen ? "true" : "false"}">
                    <div class="map-popup-platform-title">
                        <span class="platform-label">Platform ${escapeHtml(platform)}</span>
                        <div class="map-popup-platform-icons">${iconsHtml}</div>
                    </div>
                    <span class="map-popup-toggle-icon">${isOpen ? "-" : "+"}</span>
                </button>
                <div class="map-popup-platform-content ${isOpen ? "is-open" : ""}" data-platform="${platformKey}">
                    ${rowsHtml}
                </div>
            </div>
        `;
    }).join('');
}

function wireMapPopupInteractions(container) {
    if (!container || container.dataset.wired === "true") {
        return;
    }

    container.addEventListener("click", (event) => {
        const toggle = event.target.closest(".map-popup-platform-toggle");
        if (!toggle) return;

        const platform = toggle.getAttribute("data-platform");
        const content = container.querySelector(`.map-popup-platform-content[data-platform="${platform}"]`);
        if (!content) return;

        container.querySelectorAll(".map-popup-platform-content.is-open").forEach(panel => {
            if (panel !== content) {
                panel.classList.remove("is-open");
            }
        });
        container.querySelectorAll(".map-popup-platform-toggle[aria-expanded=\"true\"]").forEach(btn => {
            if (btn !== toggle) {
                btn.setAttribute("aria-expanded", "false");
                const btnIcon = btn.querySelector(".map-popup-toggle-icon");
                if (btnIcon) {
                    btnIcon.textContent = "+";
                }
            }
        });

        const isOpen = content.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        const icon = toggle.querySelector(".map-popup-toggle-icon");
        if (icon) {
            icon.textContent = isOpen ? "-" : "+";
        }
        if (map && map._popup) {
            map._popup.update();
        }
    });

    container.dataset.wired = "true";
}

async function loadMapPopupDepartures(stationName, popupContent, markerCoords = null) {
    const container = popupContent.querySelector(".map-popup-departures");
    if (!container) return;

    const { lookupName, cityName } = await resolveMapSearchContext(stationName, markerCoords);
    applyMapCityInput(cityName);
    const hasCoords = markerCoords && Number.isFinite(markerCoords.lat) && Number.isFinite(markerCoords.lon);
    const cacheKey = hasCoords
        ? `${markerCoords.lat},${markerCoords.lon}`
        : (lookupName || stationName || "").toLowerCase();
    const cached = MAP_POPUP_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < MAP_POPUP_CACHE_TTL_MS) {
        container.innerHTML = cached.html;
        wireMapPopupInteractions(container);
        if (map && map._popup) {
            map._popup.update();
        }
        return;
    }

    container.innerHTML = '<div class="map-popup-loading">Loading departures...</div>';

    try {
        let departuresToRender = [];
        if (hasCoords) {
            const lookupResult = await lookupStopByCoords(markerCoords.lat, markerCoords.lon);
            const nearestStopId = lookupResult.stop_id;
            if (!nearestStopId) {
                throw new Error("No stop found at this location.");
            }
            const nearestStationName = lookupResult.stop_name || stationName || lookupName || String(nearestStopId);
            const byIdResponse = await fetch(`/search_by_id?stop_id=${encodeURIComponent(nearestStopId)}&station_name=${encodeURIComponent(nearestStationName)}`, {
                headers: withApiKey()
            });
            const byIdResult = await byIdResponse.json();
            if (!byIdResponse.ok || byIdResult.error) {
                throw new Error(byIdResult.error || `Failed to load departures for stop ${nearestStopId}.`);
            }
            departuresToRender = byIdResult.departures || [];
        } else {
            const fallbackName = lookupName || stationName || "";
            if (!fallbackName) {
                throw new Error("Cannot load departures: stop name is required.");
            }
            const res = await fetch(`/search?stop=${encodeURIComponent(fallbackName)}`, {
                headers: withApiKey()
            });
            const result = await res.json();
            if (!res.ok || result.error) {
                throw new Error(result.error || "Failed to load departures.");
            }
            departuresToRender = result.departures || [];
        }

        const html = buildMapPopupDeparturesHtml(departuresToRender);
        container.innerHTML = html;
        wireMapPopupInteractions(container);
        MAP_POPUP_CACHE.set(cacheKey, { timestamp: Date.now(), html });
        if (map && map._popup) {
            map._popup.update();
        }
    } catch (error) {
        console.error("Error loading map popup departures:", error);
        container.innerHTML = '<div class="map-popup-error">Could not load departures.</div>';
    }
}

function isStaleMapOverpassRequest(requestId) {
    return requestId !== mapOverpassRequestId;
}

function logStaleMapOverpassRequest(requestId) {
    console.debug(`Skipping stale map marker update for request ${requestId} (latest: ${mapOverpassRequestId})`);
}

function nextMapOverpassRequestId() {
    mapOverpassRequestId += 1;
    return mapOverpassRequestId;
}

async function updateOverpassMarkers() {
    const loadingIndicator = document.getElementById('mapLoading');
    const requestId = nextMapOverpassRequestId();
    mapOverpassActiveRequests.add(requestId);
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    const iconReadyPromise = MAP_STOP_ICON_READY;

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
        DevLog.map('Overpass API request', { requestId, bounds: { sw: { lat: sw.lat, lng: sw.lng }, ne: { lat: ne.lat, lng: ne.lng } } });
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query
        });
        const data = await response.json();
        DevLog.apiResponse('Overpass', response.status, { elements: data.elements?.length || 0, requestId });

        if (isStaleMapOverpassRequest(requestId)) {
            logStaleMapOverpassRequest(requestId);
            return;
        }

        await iconReadyPromise;

        const pendingPopupName = openMapPopupName;
        isRefreshingMapMarkers = true;
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

        let popupMarkerToOpen = null;
        for (const name in stopsByName) {
            const info = stopsByName[name];
            const avgLat = info.latSum / info.count;
            const avgLon = info.lonSum / info.count;

            const stationIcon = info.isDB ? MAP_STOP_ICONS.db : MAP_STOP_ICONS.bus;
            const marker = L.marker([avgLat, avgLon], { icon: stationIcon });
            
            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
                <div style="font-family: sans-serif; min-width: 150px;">
                    <strong style="display: block; margin-bottom: 8px;">${escapeHtml(name)}</strong>
                    <button class="search-btn" style="padding: 6px 12px; font-size: 12px; width: 100%;">
                        View Departures
                    </button>
                    <div class="map-popup-departures"></div>
                </div>
            `;
            const searchBtn = popupContent.querySelector(".search-btn");
            if (searchBtn) {
                searchBtn.addEventListener("click", (event) => {
                    event.stopPropagation();
                    selectStationFromMap(name, avgLat, avgLon);
                });
            }
            
            marker.bindPopup(popupContent, {
                autoPan: true,
                keepInView: true,
                autoPanPadding: [20, 20],
                maxWidth: 320
            });
            marker.on('popupopen', () => {
                openMapPopupName = name;
                loadMapPopupDepartures(name, popupContent, { lat: avgLat, lon: avgLon });
            });
            markersLayer.addLayer(marker);
            if (pendingPopupName && pendingPopupName === name) {
                popupMarkerToOpen = marker;
            }
        }

        if (popupMarkerToOpen) {
            popupMarkerToOpen.openPopup();
        }
    } catch (error) {
        console.error('Error fetching Overpass data:', error);
    } finally {
        mapOverpassActiveRequests.delete(requestId);
        isRefreshingMapMarkers = mapOverpassActiveRequests.size > 0;
        if (mapOverpassActiveRequests.size === 0 && loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
}

async function selectStationFromMap(name, lat, lon) {
    // Track station selection from map
    if (typeof umami !== 'undefined') {
        umami.track('map-station-select', { station: name });
    }

    switchTab('departures');
    const { lookupName, cityName } = await resolveMapSearchContext(name, { lat, lon });
    applyMapCityInput(cityName);
    try {
        const lookupResult = await lookupStopByCoords(lat, lon);
        const resolvedStopId = lookupResult.stop_id;
        if (!resolvedStopId) {
            throw new Error("No stop found at this location.");
        }
        const resolvedName = lookupResult.stop_name || lookupName || name || String(resolvedStopId);
        quickSearchById(resolvedStopId, resolvedName);
    } catch (error) {
        console.error("Error selecting map stop:", error);
        showError("No nearby stop found for this map location.");
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    // Track map locate user
    if (typeof umami !== 'undefined') {
        umami.track('map-locate-user');
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

            // Track successful geolocation
            if (typeof umami !== 'undefined') {
                umami.track('map-locate-success');
            }
        },
        (error) => {
            console.error("Error getting location:", error);
            // Track geolocation error
            if (typeof umami !== 'undefined') {
                umami.track('map-locate-error', { error: error.message });
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

async function locateNearestStation() {
    // Track locate me button click
    if (typeof umami !== 'undefined') {
        umami.track('locate-me-button');
    }

    const btn = document.getElementById("locateMeBtn");
    btn.classList.add("active");
    DevLog.location('Locate nearest station initiated');

    const findNearestStation = async (latitude, longitude) => {
        try {
            DevLog.location('Finding nearest station', { latitude, longitude });
            // We use Overpass to find nearby public transport stops
            const query = `
                [out:json][timeout:10];
                (
                  node["public_transport"="stop_position"](around:1000, ${latitude}, ${longitude});
                  node["railway"="stop"](around:1000, ${latitude}, ${longitude});
                  node["railway"="station"](around:1000, ${latitude}, ${longitude});
                  node["highway"="bus_stop"](around:1000, ${latitude}, ${longitude});
                );
                out body;
            `;
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
            DevLog.api('Overpass (locate)', 'GET', { latitude, longitude, radius: 1000 });
            const res = await fetch(url);
            const data = await res.json();
            DevLog.apiResponse('Overpass (locate)', res.status, { elements: data.elements?.length || 0 });

            if (!data.elements || data.elements.length === 0) {
                showError("No stations found nearby.");
                return;
            }

            // Find the nearest one
            let nearest = null;
            let minSubDist = Infinity;

            data.elements.forEach(el => {
                const dist = Math.sqrt(Math.pow(el.lat - latitude, 2) + Math.pow(el.lon - longitude, 2));
                // Check for el.tags.name instead of el.name because Overpass data has tags
                if (dist < minSubDist && el.tags && el.tags.name) {
                    minSubDist = dist;
                    nearest = el;
                }
            });

            if (nearest && nearest.tags.name) {
                document.getElementById("stopInput").value = nearest.tags.name;
                toggleClearButton();
                // Track successful nearest station found
                if (typeof umami !== 'undefined') {
                    umami.track('nearest-station-found', { station: nearest.tags.name });
                }
                searchStop();
            } else {
                showError("Could not identify the nearest station name.");
                // Track nearest station not found
                if (typeof umami !== 'undefined') {
                    umami.track('nearest-station-not-found');
                }
            }
        } catch (error) {
            console.error("Error finding nearest station:", error);
            showError("Error finding nearest station.");
        }
    };

    const override = debugMode ? getDevLocationOverride() : null;
    if (override) {
        if (typeof umami !== 'undefined') {
            umami.track('locate-me-dev-override');
        }
        DevLog.location('Using dev location override', override);
        await findNearestStation(override.latitude, override.longitude);
        btn.classList.remove("active");
        return;
    }

    if (!navigator.geolocation) {
        DevLog.location('Geolocation not supported');
        showError("Geolocation is not supported by your browser.");
        btn.classList.remove("active");
        return;
    }

    DevLog.location('Requesting browser geolocation');
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            DevLog.location('Geolocation success', { latitude, longitude, accuracy: position.coords.accuracy });
            await findNearestStation(latitude, longitude);
            btn.classList.remove("active");
        },
        (error) => {
            DevLog.error('LOCATION', 'Geolocation error', { code: error.code, message: error.message });
            console.error("Geolocation error:", error);
            showError("Could not get your location.");
            btn.classList.remove("active");
        },
        { enableHighAccuracy: true, timeout: 5000 }
    );
}

window.addEventListener("DOMContentLoaded", function() {
    DevLog.state('Application initialized', { devMode: devModeEnabled, debugMode, hasSavedPassword: !!storedDebugPassword });
    
    // Trigger search when user presses Enter in stop input
    document.getElementById("stopInput").addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            searchStop();
        }
    });

    updateFavoritesDisplay();
    updateExperimentalUI();

    // Auto-enable debug UI if dev mode is enabled or a password is saved
    if (debugMode) {
        enableDebugUI();
    }

    const urlState = getUrlStateFromPath();
    DevLog.state('Initial URL state', urlState);
    if (urlState.mode === "map") {
        switchTab("map");
    } else if (urlState.mode === "station" && urlState.stopId) {
        setFilterInputs(urlState.filters);
        quickSearchById(urlState.stopId, "", { resetFilters: false, skipDisplayUpdate: true });
    } else {
        const home = getHomeStation();
        if (home) {
            DevLog.state('Loading home station', home);
            if (home.id) {
                quickSearchById(home.id, home.name);
            } else {
                quickSearch(home.name);
            }
        } else {
            DevLog.state('No home station, loading default');
            quickSearch("Hauptbahnhof Vorplatz");
        }
    }
});

window.addEventListener("popstate", () => {
    applyUrlState();
});

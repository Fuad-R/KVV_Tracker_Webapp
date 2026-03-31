from flask import Flask, render_template, jsonify, request
import os
import re
import secrets
import requests
from datetime import datetime, timedelta
import logging

TRANSIT_APP = "Transit App"

DEV_MODE = (os.getenv("dev") or os.getenv("DEV") or "false").strip().lower() == "true"
BASE_URL = "https://transitapi-dev.fuadserver.uk/api" if DEV_MODE else "https://transitapi.fuadserver.uk/api"
API_KEY = os.getenv("API_KEY", "")
MAX_MINUTES = 30
# Use the nearby stops API with a strict 50m radius and a single best match.
MAP_STOP_SEARCH_RADIUS_METERS = 50
MAP_STOP_SEARCH_LIMIT = 1

# Debug password must be set via environment variable (DEBUG_PASSWORD).
# enter debug mode by typing test-dev-debug in station search
DEBUG_PASSWORD = os.getenv("DEBUG_PASSWORD", "")
if not DEBUG_PASSWORD:
    logging.warning(
        "DEBUG_PASSWORD environment variable is not set. "
        "Debug endpoints will be inaccessible until a password is configured."
    )
DEBUG_OVERRIDES = {}  # Format: { (stop_id, line, direction, time): { ... } }

# Stop ID validation pattern: alphanumeric IDs with optional separators
STOP_ID_PATTERN = re.compile(r"^[a-zA-Z0-9:_\-\.]{1,64}$")

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))


# ---------------- SECURITY HEADERS ----------------
@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self)"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://umami.fuadserver.uk; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: https://*.tile.openstreetmap.org https://*.tile-cyclosm.openstreetmap.fr https://tiles.openrailwaymap.org https://tileserver.memomaps.de; "
        "connect-src 'self' https://overpass-api.de https://nominatim.openstreetmap.org https://umami.fuadserver.uk; "
        "font-src 'self'; "
        "frame-ancestors 'none';"
    )
    if not DEV_MODE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    dynamic_no_store_endpoints = {
        "index",
        "search",
        "search_by_id",
        "lookup_stop_by_coords",
        "debug_login",
        "debug_update",
        "debug_clear",
    }
    if request.endpoint in dynamic_no_store_endpoints:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif request.endpoint in {"serve_sw", "serve_manifest"}:
        response.headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"

    return response


# ---------------- DEV MODE LOGGING ----------------
# Configure logging for dev mode
if DEV_MODE:
    logging.basicConfig(
        level=logging.DEBUG,
        format='[%(asctime)s] [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S'
    )
    app.logger.setLevel(logging.DEBUG)
    app.logger.info("Dev mode enabled - debug logging active")
    app.logger.debug(f"Using API base URL: {BASE_URL}")


def dev_log(category: str, message: str, data: dict = None):
    """Log messages only in dev mode."""
    if not DEV_MODE:
        return
    if data:
        app.logger.debug(f"[{category}] {message} | {data}")
    else:
        app.logger.debug(f"[{category}] {message}")


def is_valid_stop_id(stop_id: str) -> bool:
    """Validate stop ID format to prevent injection via external API calls."""
    return bool(stop_id and STOP_ID_PATTERN.match(stop_id))

# ---------------- API ----------------

def extract_search_locations(payload):
    """Normalize stop search payloads to location entries (or [] for unknown payloads)."""
    if isinstance(payload, dict):
        return payload.get("locations", [])
    return payload if isinstance(payload, list) else []

def extract_station_name_from_departures(departures):
    if not departures:
        return None
    for departure in departures:
        if not isinstance(departure, dict):
            continue
        for key in ("stop_name", "stopName", "name"):
            value = departure.get(key)
            if value:
                return value
        stop_info = departure.get("stop") or departure.get("station")
        if isinstance(stop_info, dict):
            for key in ("name", "stop_name", "stopName"):
                value = stop_info.get(key)
                if value:
                    return value
    return None

def get_api_request_headers():
    if not API_KEY:
        return {}
    return {"X-API-Key": API_KEY}

def get_stop_id(stop_name: str):
    dev_log("API", f"GET {BASE_URL}/stops/search", {"q": stop_name})
    r = requests.get(
        f"{BASE_URL}/stops/search",
        params={"q": stop_name},
        headers=get_api_request_headers(),
        timeout=10,
    )
    dev_log("API-RESPONSE", f"stops/search returned {r.status_code}", {"results": len(extract_search_locations(r.json())) if r.ok else 0})
    r.raise_for_status()
    stops = extract_search_locations(r.json())
    if not stops:
        return None
    return stops[0].get("id")

def get_stop_name_by_id(stop_id: str):
    if not stop_id:
        return None
    try:
        dev_log("API", f"GET {BASE_URL}/stops/search (by ID)", {"q": stop_id})
        r = requests.get(
            f"{BASE_URL}/stops/search",
            params={"q": stop_id},
            headers=get_api_request_headers(),
            timeout=10,
        )
        dev_log("API-RESPONSE", f"stops/search returned {r.status_code}")
        r.raise_for_status()
        stops = extract_search_locations(r.json())
        fallback_name = None
        for stop in stops:
            if not isinstance(stop, dict):
                continue
            stop_identifier = stop.get("id") or stop.get("stop_id") or stop.get("stopId")
            for key in ("name", "stop_name", "stopName"):
                value = stop.get(key)
                if value:
                    if stop_identifier and str(stop_identifier) == str(stop_id):
                        return value
                    if fallback_name is None:
                        fallback_name = value
        if fallback_name:
            return fallback_name
    except requests.RequestException as e:
        dev_log("API-ERROR", f"Failed to get stop name by ID", {"stop_id": stop_id, "error": str(e)})
        return None
    return None

def get_stop_departures(stop_id: str):
    dev_log("API", f"GET {BASE_URL}/stops/{stop_id}", {"detailed": "1", "delay": "1"})
    r = requests.get(
        f"{BASE_URL}/stops/{stop_id}",
        params={"detailed": "1", "delay": "1"},
        headers=get_api_request_headers(),
        timeout=10,
    )
    result = r.json()
    dev_log("API-RESPONSE", f"stops/{stop_id} returned {r.status_code}", {"departures": len(result) if isinstance(result, list) else 0})
    r.raise_for_status()
    return result

def get_stop_notifications(stop_id: str):
    dev_log("API", f"GET {BASE_URL}/current_notifs", {"stopID": stop_id})
    r = requests.get(
        f"{BASE_URL}/current_notifs",
        params={"stopID": stop_id},
        headers=get_api_request_headers(),
        timeout=10,
    )
    result = r.json()
    dev_log("API-RESPONSE", f"current_notifs returned {r.status_code}", {"notifications": len(result) if isinstance(result, list) else 0})
    r.raise_for_status()
    return result

def get_nearby_stops(
    lat: float,
    lon: float,
    max_distance_meters: int = MAP_STOP_SEARCH_RADIUS_METERS,
    limit: int = MAP_STOP_SEARCH_LIMIT,
):
    params = {
        "lat": lat,
        "long": lon,
        "distance": max_distance_meters,
        "limit": limit,
    }
    dev_log("API", f"GET {BASE_URL}/stops/nearby", params)
    r = requests.get(
        f"{BASE_URL}/stops/nearby",
        params=params,
        headers=get_api_request_headers(),
        timeout=10,
    )
    result = r.json()
    dev_log("API-RESPONSE", f"stops/nearby returned {r.status_code}", {"results": len(result) if isinstance(result, list) else 0})
    r.raise_for_status()
    return result


# ---------------- LINE COLORS ----------------
def line_color(mot: int, line: str) -> str:
    # mot mapping:
    # 0 train, 1 commuter railway, 2 underground train, 3 city rail, 4 tram, 
    # 5 city bus, 6 regional bus, 7 coach, 8 cable car, 9 boat, 
    # 10 transit on demand, 11 other, 12 airplane, 13 regional train, 
    # 14 national train, 15 international train, 16 high-speed train, 
    # 17 rail replacement train, 18 shuttle train, 19 Bürgerbus
    
    # Tram/City Rail
    if mot in [3, 4]:
        tram_colors = {
            "1": "red",
            "2": "blue",
            "3": "brown",
            "4": "gold",
            "5": "lightblue",
            "8": "orange",
        }
        return tram_colors.get(line, "purple")
    
    # S-Bahn / Commuter Rail
    if mot == 1:
        return "green"
    
    # Bus
    if mot in [5, 6, 10, 19]:
        return "#808080" # Grey for bus
    
    # Long Distance Bus
    if mot == 7:
        return "#b35a00" # Orange/Brown for coach

    # Ferry
    if mot == 9:
        return "#0077be" # Ocean Blue for ferry
        
    # Trains
    if mot in [0, 13, 14, 15, 16]:
        return "#c30a37" # DB Red
        
    return "purple"


# ---------------- ROUTES ----------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def index(path):
    return render_template(
        "index.html",
        app_name=TRANSIT_APP,
        dev_mode=DEV_MODE,
    )


@app.route("/sw.js")
def serve_sw():
    return app.send_static_file("sw.js"), {"Content-Type": "application/javascript"}


@app.route("/manifest.json")
def serve_manifest():
    return app.send_static_file("manifest.json")


@app.route("/search")
def search():
    stop_name = request.args.get("stop")

    if not stop_name:
        dev_log("ROUTE", "/search called without stop parameter")
        return jsonify({"error": "Stop name required"}), 400

    stop_name_input = stop_name.strip()
    dev_log("ROUTE", f"/search called", {"stop": stop_name_input})
    
    current_query = stop_name_input
    stops = []
    modified = False
    
    try:
        while len(current_query) >= 3:
            stop_name_api = current_query.replace(" ", "_")
            # Pull all matching stops from the API
            dev_log("API", f"GET {BASE_URL}/stops/search", {"q": stop_name_api})
            r = requests.get(
                f"{BASE_URL}/stops/search",
                params={"q": stop_name_api},
                headers=get_api_request_headers(),
                timeout=10,
            )
            r.raise_for_status()
            stops = extract_search_locations(r.json())
            dev_log("API-RESPONSE", f"stops/search returned {r.status_code}", {"results": len(stops)})
            
            if stops:
                break
            
            # If not found, remove last character
            # If original length > 5, we can try removing up to 2 characters if needed, 
            # but the requirement says "untill the api returns a station id", 
            # and "removing the last one or two letters ... depending on its length"
            # I will remove 1 at a time to be safe and thorough.
            dev_log("SEARCH", f"No results for '{current_query}', trimming last character")
            current_query = current_query[:-1]
            modified = True

        if not stops:
            return jsonify({"error": "Stop not found"}), 404

        # Take the first match
        stop_id = stops[0]["id"]
        station_name_actual = stops[0]["name"]

        # Get departures
        data = get_stop_departures(stop_id)
        notifications = None
        try:
            notifications = get_stop_notifications(stop_id)
        except (requests.RequestException, ValueError) as e:
            dev_log("API-ERROR", "Failed to fetch current_notifs", {"stop_id": stop_id, "error": str(e)})

        # Add color, stop_id & formatted departure
        now = datetime.now()
        for d in data:
            mot = d.get("mot", 11) # Fallback to 'other'
            try:
                mot = int(mot)
            except (ValueError, TypeError):
                mot = 11
            d["color"] = line_color(mot, d["line"])
            d["stop_id"] = stop_id
            
            # Use delay_minutes from API or fallback to 0
            api_delay = d.get("delay_minutes", 0)
            try:
                api_delay = int(api_delay)
            except (ValueError, TypeError):
                api_delay = 0
            d["delay"] = api_delay

            # Calculate a stable scheduled time (timestamp rounded to minute)
            # This helps identify the same departure even as minutes_remaining decreases
            scheduled_arrival = now + timedelta(minutes=d["minutes_remaining"] - api_delay)
            stable_scheduled_time = scheduled_arrival.replace(second=0, microsecond=0).isoformat()
            d["stable_scheduled_time"] = stable_scheduled_time
            d["original_minutes"] = d["minutes_remaining"]

            # Apply debug overrides using the stable key
            override_key = f"{stop_id}|{d['line']}|{d['direction']}|{stable_scheduled_time}"
            if override_key in DEBUG_OVERRIDES:
                d.update(DEBUG_OVERRIDES[override_key])

            # Delay status (re-calculate in case override changed delay)
            delay = d.get("delay", 0)
            try:
                delay = int(delay)
            except (ValueError, TypeError):
                delay = 0
            
            if delay > 5:
                d["status_color"] = "red"
            elif delay > 0:
                d["status_color"] = "yellow"
            else:
                d["status_color"] = "#2e7d32" # Darker green

            if d["minutes_remaining"] <= MAX_MINUTES:
                d["departure_display"] = f"{d['minutes_remaining']}<span class='unit'>min</span>"
            else:
                dt = now + timedelta(minutes=d["minutes_remaining"])
                d["departure_display"] = dt.strftime("%H:%M")

            # Scheduled vs Estimated for delay display
            if delay > 1:
                scheduled_minutes = d["minutes_remaining"] - delay
                if scheduled_minutes <= MAX_MINUTES:
                    d["scheduled_display"] = f"{scheduled_minutes}<span class='unit'>min</span>"
                else:
                    dt_sched = now + timedelta(minutes=scheduled_minutes)
                    d["scheduled_display"] = dt_sched.strftime("%H:%M")

        # Return all stops and first station's departures
        response_data = {
            "station_name": station_name_actual,
            "departures": data,
            "all_stations": stops if len(stops) > 1 else None,
            "matched_stop": stops[0],
            "notifications": notifications
        }
        if modified:
            response_data["info"] = "Error searching for exact match, displaying closest match"
        
        return jsonify(response_data)

    except Exception as e:
        logging.exception("Unexpected error in /search")
        return jsonify({"error": "An internal error has occurred"}), 500

@app.route("/search_by_id")
def search_by_id():
    stop_id = request.args.get("stop_id")
    station_name = request.args.get("station_name")

    if not stop_id:
        dev_log("ROUTE", "/search_by_id called without stop_id")
        return jsonify({"error": "Stop ID required"}), 400

    if not is_valid_stop_id(stop_id):
        dev_log("ROUTE", "/search_by_id called with invalid stop_id", {"stop_id": stop_id})
        return jsonify({"error": "Invalid Stop ID format"}), 400

    dev_log("ROUTE", f"/search_by_id called", {"stop_id": stop_id, "station_name": station_name})

    try:
        data = get_stop_departures(stop_id)
        notifications = None
        try:
            notifications = get_stop_notifications(stop_id)
        except (requests.RequestException, ValueError) as e:
            dev_log("API-ERROR", "Failed to fetch current_notifs", {"stop_id": stop_id, "error": str(e)})

        # Use provided station name, fallback to API data
        station_name = station_name.strip() if station_name else ""
        if not station_name or station_name.lower() == "unknown station":
            station_name = extract_station_name_from_departures(data)
        if not station_name:
            station_name = get_stop_name_by_id(stop_id) or f"Stop ID {stop_id}"

        now = datetime.now()
        for d in data:
            mot = d.get("mot", 11) # Fallback to 'other'
            try:
                mot = int(mot)
            except (ValueError, TypeError):
                mot = 11
            d["color"] = line_color(mot, d["line"])
            d["stop_id"] = stop_id

            # Use delay_minutes from API or fallback to 0
            api_delay = d.get("delay_minutes", 0)
            try:
                api_delay = int(api_delay)
            except (ValueError, TypeError):
                api_delay = 0
            d["delay"] = api_delay

            # Calculate a stable scheduled time (timestamp rounded to minute)
            scheduled_arrival = now + timedelta(minutes=d["minutes_remaining"] - api_delay)
            stable_scheduled_time = scheduled_arrival.replace(second=0, microsecond=0).isoformat()
            d["stable_scheduled_time"] = stable_scheduled_time
            d["original_minutes"] = d["minutes_remaining"]

            # Apply debug overrides using the stable key
            override_key = f"{stop_id}|{d['line']}|{d['direction']}|{stable_scheduled_time}"
            if override_key in DEBUG_OVERRIDES:
                d.update(DEBUG_OVERRIDES[override_key])

            # Delay status (re-calculate in case override changed delay)
            delay = d.get("delay", 0)
            try:
                delay = int(delay)
            except (ValueError, TypeError):
                delay = 0
            
            if delay > 5:
                d["status_color"] = "red"
            elif delay > 0:
                d["status_color"] = "yellow"
            else:
                d["status_color"] = "#2e7d32" # Darker green

            if d["minutes_remaining"] <= MAX_MINUTES:
                d["departure_display"] = f"{d['minutes_remaining']}<span class='unit'>min</span>"
            else:
                dt = now + timedelta(minutes=d["minutes_remaining"])
                d["departure_display"] = dt.strftime("%H:%M")

            # Scheduled vs Estimated for delay display
            if delay > 1:
                scheduled_minutes = d["minutes_remaining"] - delay
                if scheduled_minutes <= MAX_MINUTES:
                    d["scheduled_display"] = f"{scheduled_minutes}<span class='unit'>min</span>"
                else:
                    dt_sched = now + timedelta(minutes=scheduled_minutes)
                    d["scheduled_display"] = dt_sched.strftime("%H:%M")

        return jsonify({
            "station_name": station_name,
            "departures": data,
            "notifications": notifications
        })

    except Exception as e:
        logging.exception("Unexpected error in /search_by_id")
        return jsonify({"error": "An internal error has occurred"}), 500

@app.route("/lookup_stop_by_coords")
def lookup_stop_by_coords():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    dev_log("ROUTE", "/lookup_stop_by_coords called", {"lat": lat, "lon": lon})
    if lat is None or lon is None:
        return jsonify({"error": "Latitude and longitude required"}), 400

    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        dev_log("ROUTE-ERROR", "Invalid coordinates provided", {"lat": lat, "lon": lon})
        return jsonify({"error": "Invalid coordinates"}), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        dev_log("ROUTE-ERROR", "Coordinates out of range", {"lat": lat, "lon": lon})
        return jsonify({"error": "Coordinates out of range"}), 400

    try:
        dev_log("API", "Finding nearest stop via nearby stops endpoint", {
            "lat": lat,
            "lon": lon,
            "distance": MAP_STOP_SEARCH_RADIUS_METERS,
            "limit": MAP_STOP_SEARCH_LIMIT,
        })
        nearby_stops = get_nearby_stops(lat, lon)
        if not nearby_stops:
            dev_log("API-RESPONSE", "No nearby stop found")
            return jsonify({"error": "No nearby stop found"}), 404
        stop = nearby_stops[0]
        dev_log("API-RESPONSE", "Found nearest stop", stop)
        return jsonify({
            "stop_id": stop["stop_id"],
            "stop_name": stop["stop_name"],
            "distance_meters": stop["distance_meters"]
        })
    except requests.RequestException as e:
        dev_log("API-ERROR", "Error finding nearest stop via nearby stops endpoint", {"error": str(e)})
        logging.exception("Error finding nearest stop via nearby stops endpoint")
        return jsonify({"error": "Service temporarily unavailable"}), 503
    except Exception as e:
        dev_log("API-ERROR", "Unexpected error in lookup_stop_by_coords", {"error": str(e)})
        logging.exception("Unexpected error in lookup_stop_by_coords")
        return jsonify({"error": "An internal error has occurred"}), 500


# ---------------- DEBUG ENDPOINTS ----------------

def _check_debug_password(password):
    """Verify a debug password using constant-time comparison."""
    if not DEBUG_PASSWORD:
        return False
    return secrets.compare_digest(password or "", DEBUG_PASSWORD)


@app.route("/debug/login", methods=["POST"])
def debug_login():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"success": False, "error": "Invalid request"}), 400
    password = body.get("password", "")
    dev_log("DEBUG", "/debug/login attempt")
    if _check_debug_password(password):
        dev_log("DEBUG", "/debug/login successful")
        return jsonify({"success": True})
    dev_log("DEBUG", "/debug/login failed - invalid password")
    return jsonify({"success": False, "error": "Invalid password"}), 401


@app.route("/debug/update", methods=["POST"])
def debug_update():
    password = request.headers.get("X-Debug-Password", "")
    if not (_check_debug_password(password) or (DEV_MODE and password == "dev-mode")):
        dev_log("DEBUG", "/debug/update unauthorized attempt")
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    stop_id = data.get("stop_id")
    line = data.get("line")
    direction = data.get("direction")
    stable_scheduled_time = data.get("stable_scheduled_time")

    dev_log("DEBUG", "/debug/update called", {"stop_id": stop_id, "line": line, "direction": direction})

    if any(v is None for v in [stop_id, line, direction, stable_scheduled_time]):
        return jsonify({"error": "Missing parameters"}), 400

    override_key = f"{stop_id}|{line}|{direction}|{stable_scheduled_time}"
    
    overrides = {}
    if "minutes_remaining" in data:
        try:
            overrides["minutes_remaining"] = int(data["minutes_remaining"])
        except ValueError:
            pass
    if "delay" in data:
        try:
            overrides["delay"] = int(data["delay"])
        except ValueError:
            pass
    
    if overrides:
        DEBUG_OVERRIDES[override_key] = overrides
        dev_log("DEBUG", f"Added override", {"key": override_key, "overrides": overrides})
    elif override_key in DEBUG_OVERRIDES:
        del DEBUG_OVERRIDES[override_key]
        dev_log("DEBUG", f"Removed override", {"key": override_key})

    return jsonify({"success": True, "overrides": DEBUG_OVERRIDES})


@app.route("/debug/clear", methods=["POST"])
def debug_clear():
    password = request.headers.get("X-Debug-Password", "")
    if not (_check_debug_password(password) or (DEV_MODE and password == "dev-mode")):
        dev_log("DEBUG", "/debug/clear unauthorized attempt")
        return jsonify({"error": "Unauthorized"}), 401
    
    count = len(DEBUG_OVERRIDES)
    DEBUG_OVERRIDES.clear()
    dev_log("DEBUG", f"/debug/clear - cleared {count} overrides")
    return jsonify({"success": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=DEV_MODE)

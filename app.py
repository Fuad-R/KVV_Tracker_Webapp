from flask import Flask, render_template, jsonify, request
from contextlib import closing
import os
import psycopg2
import requests
from datetime import datetime, timedelta

TRANSIT_APP = "Transit App"

#balls
DEV_MODE = (os.getenv("dev") or os.getenv("DEV") or "false").strip().lower() == "true"
BASE_URL = "https://transitapi-dev.fuadserver.uk/api" if DEV_MODE else "https://transitapi.fuadserver.uk/api"
MAX_MINUTES = 30
# Map stop lookup radius per requirements (300m).
MAP_STOP_SEARCH_RADIUS_METERS = 300
DB_CONNECTION_PATH = "/config/db_connection.txt"
REQUIRED_DB_SETTINGS = {"host", "port", "dbname", "user", "password"}

DEBUG_PASSWORD = "fuadsux"
#enter debug mode by typing test-dev-debug in station search
DEBUG_OVERRIDES = {}  # Format: { (stop_id, line, direction, time): { ... } }

app = Flask(__name__)

# ---------------- API ----------------

def extract_search_locations(payload):
    """Normalize stop search payloads to location entries (or [] for unknown payloads)."""
    if isinstance(payload, dict):
        return payload.get("locations", [])
    return payload if isinstance(payload, list) else []

def get_stop_id(stop_name: str):
    r = requests.get(f"{BASE_URL}/stops/search", params={"q": stop_name}, timeout=10)
    r.raise_for_status()
    stops = extract_search_locations(r.json())
    if not stops:
        return None
    return stops[0].get("id")

def get_stop_departures(stop_id: str):
    r = requests.get(f"{BASE_URL}/stops/{stop_id}", params={"detailed": "1", "delay": "1"}, timeout=10)
    r.raise_for_status()
    return r.json()

def load_db_connection_config(path: str = DB_CONNECTION_PATH):
    if not os.path.exists(path):
        return None
    config = {}
    with open(path, "r", encoding="utf-8") as config_file:
        for line in config_file:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            config[key.strip()] = value.strip()
    return config

def get_db_connection():
    config = load_db_connection_config()
    if not config:
        raise FileNotFoundError(f"Database connection file not found at {DB_CONNECTION_PATH}")
    missing_keys = REQUIRED_DB_SETTINGS - set(config.keys())
    if missing_keys:
        missing_list = ", ".join(sorted(missing_keys))
        raise ValueError(f"Database connection file missing required settings: {missing_list}")
    return psycopg2.connect(**config)

def find_nearest_stop(lat: float, lon: float, max_distance_meters: int = MAP_STOP_SEARCH_RADIUS_METERS):
    query = """
        SELECT stop_id, stop_name, distance
        FROM (
            SELECT stop_id, stop_name,
                6371000 * acos(
                    LEAST(1.0, GREATEST(-1.0,
                        cos(radians(%s)) * cos(radians(stop_lat)) * cos(radians(stop_lon) - radians(%s)) +
                        sin(radians(%s)) * sin(radians(stop_lat))
                    ))
                ) AS distance
            FROM stops
            WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL
        ) AS distances
        WHERE distance <= %s
        ORDER BY distance ASC
        LIMIT 1;
    """
    with closing(get_db_connection()) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (lat, lon, lat, max_distance_meters))
            row = cur.fetchone()
            if not row:
                return None
            return {"stop_id": row[0], "stop_name": row[1], "distance_meters": float(row[2])}


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
    return render_template("index.html", app_name=TRANSIT_APP)


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
        return jsonify({"error": "Stop name required"}), 400

    stop_name_input = stop_name.strip()
    
    current_query = stop_name_input
    stops = []
    modified = False
    
    try:
        while len(current_query) >= 3:
            stop_name_api = current_query.replace(" ", "_")
            # Pull all matching stops from the API
            r = requests.get(f"{BASE_URL}/stops/search", params={"q": stop_name_api}, timeout=10)
            r.raise_for_status()
            stops = extract_search_locations(r.json())
            
            if stops:
                break
            
            # If not found, remove last character
            # If original length > 5, we can try removing up to 2 characters if needed, 
            # but the requirement says "untill the api returns a station id", 
            # and "removing the last one or two letters ... depending on its length"
            # I will remove 1 at a time to be safe and thorough.
            current_query = current_query[:-1]
            modified = True

        if not stops:
            return jsonify({"error": "Stop not found"}), 404

        # Take the first match
        stop_id = stops[0]["id"]
        station_name_actual = stops[0]["name"]

        # Get departures
        data = get_stop_departures(stop_id)

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
            "matched_stop": stops[0]
        }
        if modified:
            response_data["info"] = "Error searching for exact match, displaying closest match"
        
        return jsonify(response_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/search_by_id")
def search_by_id():
    stop_id = request.args.get("stop_id")
    station_name = request.args.get("station_name")

    if not stop_id:
        return jsonify({"error": "Stop ID required"}), 400

    try:
        data = get_stop_departures(stop_id)

        # Use provided station name, fallback to API data
        if not station_name:
            station_name = data[0].get("stop_name", "Unknown station") if data else "Unknown station"

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
            "departures": data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/lookup_stop_by_coords")
def lookup_stop_by_coords():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if lat is None or lon is None:
        return jsonify({"error": "Latitude and longitude required"}), 400

    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid coordinates"}), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return jsonify({"error": "Coordinates out of range"}), 400

    try:
        stop = find_nearest_stop(lat, lon)
        if not stop:
            return jsonify({"error": "No nearby stop found"}), 404
        return jsonify({
            "stop_id": stop["stop_id"],
            "stop_name": stop["stop_name"],
            "distance_meters": stop["distance_meters"]
        })
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- DEBUG ENDPOINTS ----------------

@app.route("/debug/login", methods=["POST"])
def debug_login():
    password = request.json.get("password")
    if password == DEBUG_PASSWORD:
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Invalid password"}), 401


@app.route("/debug/update", methods=["POST"])
def debug_update():
    # Basic check for password (simplified for debug purposes, should be token-based in real app)
    password = request.headers.get("X-Debug-Password")
    if password != DEBUG_PASSWORD:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    stop_id = data.get("stop_id")
    line = data.get("line")
    direction = data.get("direction")
    stable_scheduled_time = data.get("stable_scheduled_time")

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
    elif override_key in DEBUG_OVERRIDES:
        del DEBUG_OVERRIDES[override_key]

    return jsonify({"success": True, "overrides": DEBUG_OVERRIDES})


@app.route("/debug/clear", methods=["POST"])
def debug_clear():
    password = request.headers.get("X-Debug-Password")
    if password != DEBUG_PASSWORD:
        return jsonify({"error": "Unauthorized"}), 401
    
    DEBUG_OVERRIDES.clear()
    return jsonify({"success": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

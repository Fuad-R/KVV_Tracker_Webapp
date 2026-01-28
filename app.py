from flask import Flask, render_template, jsonify, request
import requests
from datetime import datetime, timedelta
#balls
BASE_URL = "https://kvvapi.fuadserver.uk/api"
MAX_MINUTES = 30

DEBUG_PASSWORD = "fuadsux"
#enter debug mode by typing test-dev-debug in station search
DEBUG_OVERRIDES = {}  # Format: { (stop_id, line, direction, time): { ... } }

app = Flask(__name__)

# ---------------- API ----------------


def get_stop_id(stop_name: str):
    r = requests.get(f"{BASE_URL}/stops/search", params={"q": stop_name}, timeout=10)
    r.raise_for_status()
    data = r.json()
    return data[0]["id"] if data else None


def get_stop_departures(stop_id: str):
    r = requests.get(f"{BASE_URL}/stops/{stop_id}", params={"detailed": "1", "delay": "1"}, timeout=10)
    r.raise_for_status()
    return r.json()


# ---------------- LINE COLORS ----------------
def line_color(line: str) -> str:
    l = line.lower()
    if l.startswith("s"):
        return "green"
    tram_colors = {
        "1": "red",
        "2": "blue",
        "3": "brown",
        "4": "gold",
        "5": "lightblue",
        "8": "orange",
    }
    return tram_colors.get(line, "purple")


# ---------------- ROUTES ----------------
@app.route("/")
def index():
    return render_template("index.html")


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
    stop_name_api = stop_name_input.replace(" ", "_")
    try:
        # Pull all matching stops from the API
        r = requests.get(f"{BASE_URL}/stops/search", params={"q": stop_name_api}, timeout=10)
        r.raise_for_status()
        stops = r.json()

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
            d["color"] = line_color(d["line"])
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
        return jsonify({
            "station_name": station_name_actual,
            "departures": data,
            "all_stations": stops if len(stops) > 1 else None
        })

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
            d["color"] = line_color(d["line"])
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

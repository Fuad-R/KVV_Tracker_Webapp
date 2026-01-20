from flask import Flask, render_template, jsonify, request
import requests
from datetime import datetime, timedelta

BASE_URL = "https://kvvapi.fuadserver.uk/api"
MAX_MINUTES = 30

app = Flask(__name__)

# ---------------- API ----------------

def get_stop_id(stop_name: str):
    r = requests.get(f"{BASE_URL}/stops/search", params={"q": stop_name}, timeout=10)
    r.raise_for_status()
    data = r.json()
    return data[0]["id"] if data else None

def get_stop_departures(stop_id: str):
    r = requests.get(f"{BASE_URL}/stops/{stop_id}", timeout=10)
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
        station_name_actual = stops[0]["name"]  # <-- actual API name

        # Get departures
        data = get_stop_departures(stop_id)

        # Add color & formatted departure
        for d in data:
            d["color"] = line_color(d["line"])
            if d["minutes_remaining"] <= MAX_MINUTES:
                d["departure_display"] = str(d["minutes_remaining"])
            else:
                dt = datetime.now() + timedelta(minutes=d["minutes_remaining"])
                d["departure_display"] = dt.strftime("%H:%M")

        # Return station name from API
        return jsonify({
            "station_name": station_name_actual,
            "departures": data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/search_by_id")
def search_by_id():
    stop_id = request.args.get("stop_id")
    if not stop_id:
        return jsonify({"error": "Stop ID required"}), 400

    try:
        data = get_stop_departures(stop_id)

        station_name = data[0].get("stop_name", "Unknown station") if data else "Unknown station"

        for d in data:
            d["color"] = line_color(d["line"])
            if d["minutes_remaining"] <= MAX_MINUTES:
                d["departure_display"] = str(d["minutes_remaining"])
            else:
                dt = datetime.now() + timedelta(minutes=d["minutes_remaining"])
                d["departure_display"] = dt.strftime("%H:%M")

        return jsonify({
            "station_name": station_name,
            "departures": data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/future_departures")
def future_departures():
    stop_name = request.args.get("stop")
    line = request.args.get("line")
    direction = request.args.get("direction")
    if not all([stop_name, line, direction]):
        return jsonify({"error": "Missing parameters"}), 400

    stop_name = stop_name.replace(" ", "_")
    try:
        stop_id = get_stop_id(stop_name)
        if not stop_id:
            return jsonify({"error": "Stop not found"}), 404
        data = get_stop_departures(stop_id)

        future = [
            d for d in data
            if str(d["line"]).strip().lower() == str(line).strip().lower()
               and str(d["direction"]).strip().lower() == str(direction).strip().lower()
        ]

        # Sort and format
        future.sort(key=lambda x: x["minutes_remaining"])
        for d in future:
            if d["minutes_remaining"] <= MAX_MINUTES:
                d["departure_display"] = str(d["minutes_remaining"])
            else:
                dt = datetime.now() + timedelta(minutes=d["minutes_remaining"])
                d["departure_display"] = dt.strftime("%H:%M")
        return jsonify(future)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

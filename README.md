# Transit Tracker Webapp

A Flask-based web application to track real-time departures of the Transit App (Karlsruher Verkehrsverbund).

## Features

- **Real-time Departures**: View live departure information for any Transit App station.
- **Line Colors**: Tram and S-Bahn lines are color-coded for easy identification (e.g., S-Bahn is green, Line 1 is red, etc.).
- **Search**: Search for stations by name or by ID.
- **Favorites & Home Station**: Save your frequently used stations for quick access.
- **PWA Support**: Installable as a Progressive Web App with offline support via Service Workers.
- **Debug Mode**: Advanced mode to override departure data (use `test-dev-debug` in search).
- **Dark/Light Mode**: Theme support for better visibility.
- **Nearby Stop Lookup**: Map stop selection resolves the nearest stop through the Transit Tracker API nearby-stops endpoint.
- **Dockerized**: Easy deployment using Docker.

## Ranked Feature Ideas (User Need & Impact)

| Rank | Feature Idea | User Need | Why It Matters |
| --- | --- | --- | --- |
| 1 | **Service alerts & disruption notifications** | High | Real-time disruption notices prevent missed connections and reduce stress during outages. |
| 2 | **Departure reminders ("leave now" alerts)** | High | Timely nudges based on walking time help riders catch departures, especially for favorites. |
| 3 | **Multi-station dashboard** | High | Commuters often monitor multiple nearby stops; a single view saves repeated searches. |
| 4 | **Accessibility & elevator status** | Medium-High | Critical for mobility-impaired riders to plan viable routes and avoid closed access. |
| 5 | **Line-specific delay summaries** | Medium | Quick summaries for a favorite line reduce scrolling and improve decision-making. |
| 6 | **Offline fallback (last known departures)** | Medium | Provides a graceful experience during poor connectivity, common in tunnels or stations. |

## Prerequisites

- Python 3.11+
- [Optional] Docker

## Installation & Running

### Local Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd Transit_Tracker_Webapp
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application**:
   ```bash
   python app.py
   ```
   The app will be available at `http://localhost:5000`.

### Docker Setup

1. **Build the Docker image**:
   ```bash
   docker build -t transit-tracker .
   ```

2. **Run the container**:
   ```bash
   docker run -p 5000:5000 transit-tracker
   ```

## Usage

### Station Search
Type the name of a station in the search bar to get real-time departures.

### Debug Mode
To enter debug mode:
1. Type `test-dev-debug` into the station search bar.
2. Enter the debug password (default: `fuadsux`).
3. In debug mode, you can override departure times and delays, pause updates, clear overrides, reset saved app data, and access a map view.

To enable dev mode automatically (including Flask debug and UI debug tools), set `DEV=true` (or `dev=true`) in the environment. Leave it unset/false in production to keep debug tools off by default.

## Project Structure

- `app.py`: Main Flask application backend.
- `templates/`: HTML templates.
- `static/`: Static assets (CSS, JS, icons, manifest, service worker).
- `Dockerfile`: Configuration for Docker deployment.
- `requirements.txt`: Python dependencies.

## API Reference

The app uses an external API: `https://transitapi.fuadserver.uk/api`

For map-based stop selection, the webapp now uses the nearby stop API endpoint and requests the single closest stop within 50 meters.

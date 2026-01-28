# KVV Tracker Webapp

A Flask-based web application to track real-time departures of the KVV (Karlsruher Verkehrsverbund).

## Features

- **Real-time Departures**: View live departure information for any KVV station.
- **Line Colors**: Tram and S-Bahn lines are color-coded for easy identification (e.g., S-Bahn is green, Line 1 is red, etc.).
- **Search**: Search for stations by name or by ID.
- **Favorites & Home Station**: Save your frequently used stations for quick access.
- **PWA Support**: Installable as a Progressive Web App with offline support via Service Workers.
- **Debug Mode**: Advanced mode to override departure data (use `test-dev-debug` in search).
- **Dark/Light Mode**: Theme support for better visibility.
- **Dockerized**: Easy deployment using Docker.

## Prerequisites

- Python 3.11+
- [Optional] Docker

## Installation & Running

### Local Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd KVV_Tracker_Webapp
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
   docker build -t kvv-tracker .
   ```

2. **Run the container**:
   ```bash
   docker run -p 5000:5000 kvv-tracker
   ```

## Usage

### Station Search
Type the name of a station in the search bar to get real-time departures.

### Debug Mode
To enter debug mode:
1. Type `test-dev-debug` into the station search bar.
2. Enter the debug password (default: `fuadsux`).
3. In debug mode, you can override departure times and delays, pause updates, and access a map view.

## Project Structure

- `app.py`: Main Flask application backend.
- `templates/`: HTML templates.
- `static/`: Static assets (CSS, JS, icons, manifest, service worker).
- `Dockerfile`: Configuration for Docker deployment.
- `requirements.txt`: Python dependencies.

## API Reference

The app uses an external API: `https://kvvapi.fuadserver.uk/api`

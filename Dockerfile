# Use a lightweight Python base image
FROM python:3.12-slim

# Set the working directory inside the container
WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Environment variables for security configuration (set at runtime):
#   DEBUG_PASSWORD   – password for debug endpoints (required for debug access)
#   FLASK_SECRET_KEY – secret key for Flask sessions (auto-generated if not set)

# Command to run your application (update 'app.py' to your entrypoint)
CMD ["python", "app.py"]
FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend/ ./backend/

EXPOSE 5000

CMD ["gunicorn", "-b", "0.0.0.0:5000", "backend.app:app"]

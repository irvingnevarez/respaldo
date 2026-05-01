FROM python:3.11-slim

# FFmpeg para composición de video
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY . .

# Directorio para ChromaDB y SQLite
RUN mkdir -p /data/chroma_db

ENV SQLITE_URL=sqlite+aiosqlite:////data/printbot.db
ENV CHROMA_PERSIST_DIR=/data/chroma_db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

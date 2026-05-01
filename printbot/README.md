# PrintBot Marketing Agent 🖨️

Agente autónomo de marketing para **Lummy Designs** — negocio de serigrafía, DTF y productos personalizados de lujo en México.

Genera contenido automático para **Instagram, TikTok, Facebook y WhatsApp Business** con aprobación humana (HITL) antes de publicar.

---

## Stack

| Componente | Tecnología |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Orquestador | Claude Sonnet 4.6 (Anthropic) |
| Sub-agentes | Claude Haiku 4.5 |
| Imágenes | DALL-E 3 Standard |
| Video | FFmpeg + Jinja2 templates |
| Vector DB | ChromaDB (local) |
| Embeddings | text-embedding-3-small (OpenAI) |
| Base de datos | SQLite + SQLAlchemy + Alembic |
| Scheduler | APScheduler |
| Media CDN | Cloudinary free tier |

**Presupuesto objetivo: $30 USD/mes** (estimado real: ~$14/mes)

---

## Instalación rápida

### Prerequisitos
- Python 3.11+
- FFmpeg instalado en el sistema (`brew install ffmpeg` / `apt install ffmpeg`)
- Docker (opcional, recomendado)

### 1. Clonar y configurar entorno

```bash
git clone <repo>
cd printbot
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

### 2. Variables de entorno

```bash
cp .env.example .env
# Editar .env con tus API keys
```

### 3. Base de datos

```bash
alembic upgrade head
```

### 4. Semilla de conocimiento de marca

```bash
python scripts/seed_knowledge_base.py
python scripts/seed_prompts.py
```

### 5. Ejecutar

```bash
uvicorn app.main:app --reload
# Swagger UI disponible en: http://localhost:8000/docs
```

---

## Con Docker

```bash
docker-compose up --build
```

---

## Uso básico

### Generar contenido para la semana

```bash
curl -X POST http://localhost:8000/api/v1/campaigns \
  -H "Content-Type: application/json" \
  -d '{"type": "weekly", "platforms": ["instagram", "facebook", "tiktok", "whatsapp"]}'
```

### Revisar posts pendientes (HITL)

```
GET http://localhost:8000/api/v1/posts?status=pending
```

### Aprobar un post

```bash
curl -X POST http://localhost:8000/api/v1/posts/{id}/approve
```

### Ver gasto del mes

```
GET http://localhost:8000/api/v1/analytics/budget
```

---

## Estructura del proyecto

```
printbot/
├── app/
│   ├── main.py               # FastAPI factory
│   ├── config.py             # Settings desde .env
│   ├── agents/               # OrchestratorAgent + 6 sub-agentes
│   ├── api/v1/               # Endpoints REST
│   ├── models/               # SQLAlchemy ORM
│   ├── services/             # Publishers, DALL-E, FFmpeg, Cloudinary
│   ├── knowledge/            # ChromaDB RAG
│   └── prompts/              # YAML versionados por agente
├── knowledge_base/           # JSON fuente de verdad de marca
├── video_templates/          # Plantillas FFmpeg
└── tests/
```

---

## Variables de entorno requeridas

Ver `.env.example` para la lista completa. Las mínimas para arrancar:

- `ANTHROPIC_API_KEY` — Claude API
- `OPENAI_API_KEY` — DALL-E 3 + embeddings
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

Las keys de Meta/TikTok/WhatsApp son necesarias solo para publicación real.

---

## API Docs

Con el servidor corriendo, visita:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

---

## Verificación de presupuesto

```bash
python scripts/check_budget.py
```

El agente se detiene automáticamente a los $28 USD/mes. Alerta a $20 USD.

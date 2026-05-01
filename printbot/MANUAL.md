# MANUAL DE USUARIO — PRINTBOT MARKETING AGENT
### Lummy Designs · Agente Autónomo de Marketing Digital

---

```
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║      🤖  PrintBot genera contenido, tú decides si se publica.           ║
║                                                                          ║
║      Instagram · Facebook · TikTok · WhatsApp Business                  ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## TABLA DE CONTENIDO

| # | Sección | ¿Para qué sirve? |
|---|---------|-----------------|
| 1 | [¿Qué es PrintBot?](#1--qué-es-printbot) | Entender el sistema en 2 minutos |
| 2 | [Instalación (primera vez)](#2--instalación-primera-vez) | Arrancar el sistema desde cero |
| 3 | [Crear una campaña](#3--crear-una-campaña) | Pedirle al agente que genere contenido |
| 4 | [Aprobar o rechazar posts](#4--aprobar-o-rechazar-posts) | Revisar lo que el agente creó antes de publicar |
| 5 | [Gestión de comentarios y DMs](#5--gestión-de-comentarios-y-dms) | Responder a clientes con ayuda de IA |
| 6 | [Ver el calendario editorial](#6--ver-el-calendario-editorial) | Ver el plan de contenido de la semana |
| 7 | [Métricas y presupuesto](#7--métricas-y-presupuesto) | Cuánto está funcionando y cuánto cuesta |
| 8 | [Base de conocimiento](#8--base-de-conocimiento) | Actualizar la información de tu marca |
| 9 | [Gestión de prompts](#9--gestión-de-prompts) | Cambiar cómo habla el agente |
| 10 | [Solución de problemas](#10--solución-de-problemas) | Qué hacer si algo falla |

---

## 1 · ¿Qué es PrintBot?

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   TÚ dices:  "Genera contenido para esta semana"                   │
│                          │                                          │
│                          ▼                                          │
│              🤖  PrintBot trabaja:                                  │
│              • Crea el plan de la semana (qué publicar y cuándo)   │
│              • Escribe los textos para cada red social              │
│              • Genera las imágenes con IA                           │
│              • Compone los videos automáticamente                   │
│                          │                                          │
│                          ▼                                          │
│   TÚ revisas:  "¿Está bien este post? → APROBAR / RECHAZAR"        │
│                          │                                          │
│                          ▼                                          │
│              📱  PrintBot publica a la hora programada              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Regla de oro

> **PrintBot nunca publica nada sin tu aprobación.**
> Todo pasa primero por tu revisión.

### ¿Cuánto cuesta al mes?

| Concepto | Costo estimado |
|----------|---------------|
| Claude IA (agente principal) | ~$4.35 USD |
| Imágenes generadas con IA | ~$3.60 USD |
| Almacenamiento en Cloudinary | $0.00 |
| APIs de redes sociales | $0.00 |
| **Total estimado** | **~$13 USD/mes** |
| **Límite máximo configurado** | **$28 USD/mes** |

---

## 2 · Instalación (primera vez)

### Paso 1 — Requisitos previos

Necesitas tener instalado en tu computadora:

```
✅  Python 3.11 o superior    →  python --version
✅  FFmpeg                    →  ffmpeg -version
✅  Git                       →  git --version
✅  Docker (opcional)         →  docker --version
```

Si te falta alguno, descárgalo de:
- Python: https://python.org/downloads
- FFmpeg: https://ffmpeg.org/download.html
- Docker: https://docker.com/get-started

---

### Paso 2 — Obtener el código

```bash
git clone https://github.com/irvingnevarez/respaldo.git
cd respaldo/printbot
```

---

### Paso 3 — Configurar las API Keys

Copia el archivo de ejemplo y ábrelo:

```bash
cp .env.example .env
```

Edita `.env` y llena los campos con tus claves:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ARCHIVO: .env                                                      │
│                                                                     │
│  ANTHROPIC_API_KEY=sk-ant-...    ← De console.anthropic.com        │
│  OPENAI_API_KEY=sk-...           ← De platform.openai.com          │
│                                                                     │
│  META_ACCESS_TOKEN=...           ← De developers.facebook.com      │
│  META_IG_USER_ID=...             ← ID de tu cuenta de Instagram     │
│  META_FB_PAGE_ID=...             ← ID de tu página de Facebook      │
│                                                                     │
│  TIKTOK_ACCESS_TOKEN=...         ← De developers.tiktok.com        │
│                                                                     │
│  WHATSAPP_PHONE_NUMBER_ID=...    ← De Meta for Developers          │
│  WHATSAPP_ACCESS_TOKEN=...       ← Token de WhatsApp Business      │
│                                                                     │
│  CLOUDINARY_CLOUD_NAME=...       ← De cloudinary.com               │
│  CLOUDINARY_API_KEY=...                                             │
│  CLOUDINARY_API_SECRET=...                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Paso 4 — Instalar y arrancar

**Opción A — Sin Docker (más rápido para probar):**

```bash
pip install -e .
python scripts/setup.py        # Inicializa base de datos + conocimiento
uvicorn app.main:app --reload  # Arranca el servidor
```

**Opción B — Con Docker (recomendado para producción):**

```bash
docker-compose up --build
```

---

### Paso 5 — Verificar que funciona

Abre tu navegador en:

```
http://localhost:8000/docs
```

Deberías ver esto:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   📄  SWAGGER UI — PrintBot API                                     │
│                                                                     │
│   /api/v1/campaigns    POST   Crear campaña                        │
│   /api/v1/posts        GET    Ver posts pendientes                  │
│   /api/v1/calendar     GET    Ver calendario                        │
│   /api/v1/analytics    GET    Ver métricas                          │
│   /api/v1/community    GET    Ver comentarios                       │
│   ...                                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**¡Listo! El sistema está funcionando.**

---

## 3 · Crear una campaña

Esto le dice al agente: *"Genera contenido para esta semana"*.

### Desde el navegador (Swagger UI)

1. Abre `http://localhost:8000/docs`
2. Busca la sección **POST /api/v1/campaigns**
3. Haz clic en **"Try it out"**
4. Pega este ejemplo y presiona **Execute**:

```json
{
  "name": "Semana de Primavera",
  "type": "weekly",
  "week_label": "2025-W18",
  "platforms": "instagram,facebook,tiktok,whatsapp"
}
```

### Desde la terminal (curl)

```bash
curl -X POST http://localhost:8000/api/v1/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Semana del Día de la Madre",
    "type": "weekly",
    "week_label": "2025-W19",
    "platforms": "instagram,facebook,tiktok,whatsapp"
  }'
```

### ¿Qué hace el agente después de recibir esto?

```
  [1] Lee tu base de conocimiento (marca, productos, clientes)
       ↓
  [2] Revisa las métricas de las últimas semanas
       ↓
  [3] Genera un plan: qué publicar, cuándo y en qué red
       ↓  (puede tomar 2-5 minutos)
  [4] Escribe los textos para cada post
       ↓
  [5] Genera las imágenes con DALL-E
       ↓
  [6] Compone los videos con FFmpeg (si hay Reels o TikToks)
       ↓
  [7] Guarda TODO en estado PENDIENTE (esperando tu aprobación)
```

### Respuesta esperada

```json
{
  "campaign_id": 1,
  "status": "generating",
  "message": "Campaña creada. El orquestador está generando contenido..."
}
```

---

## 4 · Aprobar o rechazar posts

**Este es tu trabajo más importante.** Aquí decides qué se publica y qué no.

### Ver todos los posts pendientes

```bash
GET http://localhost:8000/api/v1/posts?status=pending
```

O filtra por red social:

```bash
GET http://localhost:8000/api/v1/posts?status=pending&platform=instagram
```

Verás algo así:

```json
[
  {
    "id": 1,
    "platform": "instagram",
    "pillar": "producto_terminado",
    "caption": "✨ Cada pieza de Lummy Designs nace de tus ideas...",
    "hashtags": "#serigrafía #MéxicoHecho #LummyDesigns",
    "image_url": "https://res.cloudinary.com/lummy/...",
    "scheduled_at": "2025-05-06T10:00:00",
    "status": "pending"
  },
  ...
]
```

---

### Aprobar un post

```bash
POST http://localhost:8000/api/v1/posts/1/approve
```

```
✅  El post queda en estado "scheduled"
📅  Se publicará automáticamente a la hora programada
```

---

### Rechazar un post

```bash
POST http://localhost:8000/api/v1/posts/1/reject
Content-Type: application/json

{
  "reason": "El texto no menciona el descuento de graduación"
}
```

---

### Editar antes de aprobar

¿El texto está casi bien pero quieres cambiar algo? Edítalo:

```bash
PATCH http://localhost:8000/api/v1/posts/1
Content-Type: application/json

{
  "caption": "Tu nuevo texto aquí...",
  "hashtags": "#nuevosHashtags"
}
```

Después apruébalo:

```bash
POST http://localhost:8000/api/v1/posts/1/approve
```

---

### Publicar ahora (sin esperar la hora programada)

```bash
POST http://localhost:8000/api/v1/posts/1/publish-now
```

---

### Resumen de estados de un post

```
  PENDING ──── (tú apruebas) ────▶ SCHEDULED ──── (llega la hora) ────▶ PUBLISHED
     │                                                                       ✅
     └──── (tú rechazas) ────▶ REJECTED
                                   ❌
```

| Estado | Significado |
|--------|-------------|
| `pending` | Esperando tu revisión |
| `scheduled` | Aprobado, esperando su hora |
| `published` | Ya está en las redes sociales |
| `rejected` | Rechazado por ti |
| `failed` | Error al publicar (revisa los logs) |

---

## 5 · Gestión de comentarios y DMs

El agente puede ayudarte a responder comentarios e mensajes directos de Instagram, Facebook, TikTok y WhatsApp.

### ¿Cómo llegan los comentarios al sistema?

Los webhooks de Meta y TikTok envían notificaciones automáticas a:
```
POST http://localhost:8000/api/v1/webhooks/meta
POST http://localhost:8000/api/v1/webhooks/tiktok
```

El sistema los guarda automáticamente en la base de datos.

---

### Ver comentarios/DMs pendientes

```bash
GET http://localhost:8000/api/v1/community
```

Filtra por plataforma o estado:

```bash
GET http://localhost:8000/api/v1/community?platform=instagram&status=pending
```

---

### Generar un borrador de respuesta

El agente lee el comentario y escribe una respuesta en el tono de Lummy Designs:

```bash
POST http://localhost:8000/api/v1/community/5/draft
```

El agente devuelve:

```json
{
  "status": "ok",
  "draft": {
    "reply": "¡Hola! Claro que sí, hacemos serigrafía desde 10 piezas 🙌 Escríbenos por WhatsApp para cotizar.",
    "purchase_intent": true
  }
}
```

> 🔔 Si el agente detecta que el cliente quiere comprar (`purchase_intent: true`),
> automáticamente incluirá un enlace a WhatsApp en la respuesta.

---

### Editar el borrador

¿Quieres cambiar algo antes de enviar?

```bash
PATCH http://localhost:8000/api/v1/community/5/reply?reply=Tu%20respuesta%20editada%20aquí
```

---

### Enviar la respuesta

```bash
POST http://localhost:8000/api/v1/community/5/send
```

La respuesta se publicará directamente en:
- Instagram → como reply al comentario
- Facebook → como reply al comentario
- Instagram DM → como mensaje directo
- TikTok → como reply al comentario
- WhatsApp → como mensaje directo

---

### Flujo completo de un comentario

```
  [Comentario llega] ──webhook──▶ Sistema lo guarda (status: pending)
                                        │
                                        ▼
                           POST /community/{id}/draft
                           🤖 Agente genera borrador
                                        │
                                        ▼
                           (Tú revisas y editas si quieres)
                                        │
                                        ▼
                           POST /community/{id}/send
                           📤 Se envía a la plataforma
```

---

## 6 · Ver el calendario editorial

El calendario te muestra qué está planeado para publicar y cuándo.

### Ver la semana actual

```bash
GET http://localhost:8000/api/v1/calendar?week=2025-W18
```

### Ver un mes completo

```bash
GET http://localhost:8000/api/v1/calendar?month=2025-05
```

### Ver resumen por plataforma y pilar

```bash
GET http://localhost:8000/api/v1/calendar/summary
```

Respuesta:

```json
{
  "by_platform": {
    "instagram": 5,
    "facebook": 3,
    "tiktok": 3,
    "whatsapp": 2
  },
  "by_pillar": {
    "producto_terminado": 4,
    "proceso_artesanal": 3,
    "regalos_ocasiones": 3,
    "storytelling_cliente": 2,
    "educativo": 1
  }
}
```

### Generar solo el calendario (sin posts)

Si solo quieres ver el plan sin generar imágenes ni textos aún:

```bash
POST http://localhost:8000/api/v1/calendar/generate
Content-Type: application/json

{
  "start_date": "2025-05-05",
  "end_date": "2025-05-11",
  "platforms": ["instagram", "facebook", "tiktok", "whatsapp"]
}
```

### Mover una entrada del calendario

¿Quieres cambiar la fecha de publicación de algo?

```bash
PATCH http://localhost:8000/api/v1/calendar/3
Content-Type: application/json

{
  "scheduled_date": "2025-05-08",
  "notes": "Mover al jueves por el evento"
}
```

---

## 7 · Métricas y presupuesto

### Ver el gasto actual del mes

```bash
GET http://localhost:8000/api/v1/analytics/budget
```

Respuesta:

```json
{
  "month": "2025-05",
  "total_spent_usd": 8.42,
  "monthly_budget_usd": 30.0,
  "hard_stop_usd": 28.0,
  "alert_threshold_usd": 20.0,
  "remaining_usd": 19.58,
  "status": "ok",
  "breakdown": {
    "claude-haiku-4-5": 3.60,
    "claude-sonnet-4-6": 1.35,
    "dalle3": 2.80,
    "embeddings": 0.07
  }
}
```

### Semáforo de presupuesto

```
  Verde  🟢  < $20 USD  →  Todo bien, sigue generando
  Amarillo 🟡  $20-$28 USD →  Alerta, reduce la frecuencia
  Rojo   🔴  > $28 USD  →  STOP automático, no genera más
```

> El sistema se detiene solo si llegas a $28 USD.
> Nunca te cobrará más de eso en un mes.

---

### Ver métricas de redes sociales

```bash
GET http://localhost:8000/api/v1/analytics
```

### Forzar actualización de métricas ahora

```bash
POST http://localhost:8000/api/v1/analytics/refresh
Content-Type: application/json

{
  "force_refresh": true
}
```

---

### ¿Cuándo se actualizan las métricas automáticamente?

```
  Todos los días a las 9:00 AM (hora México City)
  ↓
  El agente jala métricas de Instagram, Facebook y TikTok
  ↓
  Las guarda en la base de datos
  ↓
  Ajusta automáticamente la estrategia de la próxima semana
```

---

## 8 · Base de conocimiento

Aquí está guardada toda la información sobre tu marca. El agente la lee cada vez que genera contenido.

### Archivos que puedes editar

```
knowledge_base/
├── brand_identity.json       ← Colores, fuentes, tono, palabras prohibidas
├── product_catalog.json      ← Productos, precios, variantes
├── buyer_personas.json       ← Perfiles de tus clientes ideales
├── content_pillars.json      ← Los 6 temas de contenido y su peso
├── seasonal_calendar.json    ← Fechas importantes: 14-Feb, Día de la Madre, etc.
├── competitor_insights.json  ← Información sobre competidores
└── hashtag_library.json      ← Sets de hashtags por pilar y plataforma
```

### Cómo actualizar la información de tu marca

1. Edita el archivo JSON que corresponda
2. Llama al endpoint para re-indexar:

```bash
POST http://localhost:8000/api/v1/knowledge/reindex
Content-Type: application/json

{
  "source": "brand_identity"
}
```

El agente usará la información actualizada en el próximo ciclo de generación.

### Ver toda la base de conocimiento

```bash
GET http://localhost:8000/api/v1/knowledge
```

### Agregar nuevo documento

```bash
POST http://localhost:8000/api/v1/knowledge
Content-Type: application/json

{
  "source": "nuevas_colecciones_2025",
  "content": "Para el verano 2025 lanzamos...",
  "metadata": {"type": "product_update", "season": "summer_2025"}
}
```

---

## 9 · Gestión de prompts

Los prompts son las "instrucciones" que le das al agente para que escriba de cierta manera. Puedes cambiarlos sin necesidad de reiniciar el sistema.

### Ver todos los prompts activos

```bash
GET http://localhost:8000/api/v1/prompts
```

### Ver prompts de un agente específico

```bash
GET http://localhost:8000/api/v1/prompts/copywriter
```

### Crear una nueva versión de un prompt

```bash
POST http://localhost:8000/api/v1/prompts
Content-Type: application/json

{
  "agent_name": "copywriter",
  "content": "Eres el copywriter de Lummy Designs...\n[Tu nuevo prompt aquí]",
  "notes": "Versión más enfocada en urgencia para ventas"
}
```

### Activar una versión de prompt

```bash
POST http://localhost:8000/api/v1/prompts/copywriter/1.1.0/activate
```

Desde ese momento el agente usará el nuevo prompt **sin reiniciar nada**.

### Comparar dos versiones

```bash
GET http://localhost:8000/api/v1/prompts/copywriter/compare?v1=1.0.0&v2=1.1.0
```

---

## 10 · Solución de problemas

### El servidor no arranca

```bash
# Verifica que Python esté bien instalado
python --version   # Debe ser 3.11 o superior

# Verifica que las dependencias estén instaladas
pip install -e .

# Verifica que el archivo .env exista y tenga las claves
cat .env
```

---

### "Budget exceeded" — El agente no genera contenido

```
Causa:   El gasto del mes llegó al límite de $28 USD
Solución: Espera al inicio del siguiente mes (se reinicia automáticamente)
          O ajusta BUDGET_HARD_STOP en tu archivo .env
```

---

### Los posts no se publican a la hora programada

```bash
# Revisa los logs del scheduler
docker-compose logs printbot | grep "publish"

# Verifica que el post esté en estado "scheduled"
GET http://localhost:8000/api/v1/posts?status=scheduled

# Publica manualmente si es urgente
POST http://localhost:8000/api/v1/posts/{id}/publish-now
```

---

### Error al publicar en Instagram / Facebook

```
Causa más común: El Meta Access Token expiró (duran ~60 días)
Solución:
  1. Ve a developers.facebook.com
  2. Genera un nuevo Long-Lived Token
  3. Actualiza META_ACCESS_TOKEN en tu archivo .env
  4. Reinicia el servidor
```

---

### Los comentarios/DMs no llegan al sistema

```
Causa: Los webhooks de Meta o TikTok no están configurados
Solución:
  1. Ve a developers.facebook.com → Tu App → Webhooks
  2. Configura la URL: https://tu-dominio.com/api/v1/webhooks/meta
  3. El token de verificación es: META_WEBHOOK_VERIFY_TOKEN en tu .env
```

---

### Cómo ver los logs en tiempo real

```bash
# Con Docker
docker-compose logs -f printbot

# Sin Docker
uvicorn app.main:app --reload --log-level debug
```

---

## REFERENCIA RÁPIDA — Endpoints más usados

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ACCIÓN                          MÉTODO   ENDPOINT                      ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Crear campaña semanal           POST     /api/v1/campaigns             ║
║  Ver posts pendientes            GET      /api/v1/posts?status=pending  ║
║  Aprobar un post                 POST     /api/v1/posts/{id}/approve    ║
║  Rechazar un post                POST     /api/v1/posts/{id}/reject     ║
║  Editar un post                  PATCH    /api/v1/posts/{id}            ║
║  Publicar ahora                  POST     /api/v1/posts/{id}/publish-now║
╠══════════════════════════════════════════════════════════════════════════╣
║  Ver calendario de la semana     GET      /api/v1/calendar?week=...     ║
║  Generar solo calendario         POST     /api/v1/calendar/generate     ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Ver comentarios pendientes      GET      /api/v1/community             ║
║  Generar borrador de respuesta   POST     /api/v1/community/{id}/draft  ║
║  Enviar respuesta                POST     /api/v1/community/{id}/send   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Ver gasto del mes               GET      /api/v1/analytics/budget      ║
║  Actualizar métricas             POST     /api/v1/analytics/refresh     ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Re-indexar conocimiento         POST     /api/v1/knowledge/reindex     ║
║  Activar versión de prompt       POST     /api/v1/prompts/{agent}/...   ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## RUTINA SEMANAL RECOMENDADA

```
LUNES
  └── Revisar métricas de la semana anterior
      GET /api/v1/analytics

LUNES O MARTES
  └── Generar campaña de la semana
      POST /api/v1/campaigns

MARTES-MIÉRCOLES
  └── Revisar y aprobar/rechazar posts generados
      GET /api/v1/posts?status=pending
      POST /api/v1/posts/{id}/approve  (o /reject)

DIARIO
  └── Revisar comentarios y DMs
      GET /api/v1/community?status=pending
      POST /api/v1/community/{id}/draft  →  /send

VIERNES
  └── Ver resumen del presupuesto
      GET /api/v1/analytics/budget
```

---

## RESUMEN EN UNA PÁGINA

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  1.  PIDES contenido  →  POST /api/v1/campaigns                     │
│                                  │                                   │
│  2.  ESPERAS 2-5 min  →  El agente trabaja solo                     │
│                                  │                                   │
│  3.  REVISAS          →  GET /api/v1/posts?status=pending           │
│                                  │                                   │
│  4.  DECIDES          →  ✅ /approve   o   ❌ /reject               │
│                                  │                                   │
│  5.  SE PUBLICA       →  Automáticamente a la hora programada       │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                      │
│  Para comentarios:                                                   │
│  GET /community  →  /draft  →  (editas si quieres)  →  /send       │
│                                                                      │
│  Para el presupuesto:                                                │
│  GET /analytics/budget  →  🟢 ok  /  🟡 alerta  /  🔴 stop         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

*PrintBot Marketing Agent — Lummy Designs · Versión 1.0*
*Documentación generada para el equipo interno. No compartir claves de API.*

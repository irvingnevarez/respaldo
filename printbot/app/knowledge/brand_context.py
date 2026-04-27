"""
Carga los archivos JSON de knowledge_base/ en ChromaDB.
Ejecutar una vez al iniciar o cuando se actualice la KB.
"""

import json
from pathlib import Path

import structlog

logger = structlog.get_logger()

KB_DIR = Path(__file__).parent.parent.parent / "knowledge_base"
COLLECTION_NAME = "lummy_brand"
SEASONAL_COLLECTION = "lummy_seasonal"

_chroma_client = None
_brand_collection = None
_seasonal_collection = None


def _get_chroma():
    global _chroma_client
    if _chroma_client is None:
        import chromadb
        from app.config import settings
        _chroma_client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
    return _chroma_client


async def init_knowledge_base() -> None:
    """Inicializa ChromaDB. Solo indexa si la colección está vacía."""
    try:
        client = _get_chroma()
        global _brand_collection, _seasonal_collection

        _brand_collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"description": "Lummy Designs brand knowledge"},
        )
        _seasonal_collection = client.get_or_create_collection(
            name=SEASONAL_COLLECTION,
            metadata={"description": "Lummy Designs seasonal calendar"},
        )

        if _brand_collection.count() == 0:
            await _index_all()
            logger.info("knowledge_base_indexed_fresh")
        else:
            logger.info("knowledge_base_already_indexed", docs=_brand_collection.count())

    except Exception as e:
        logger.warning("knowledge_base_init_failed", error=str(e))


async def _index_all() -> None:
    """Indexa todos los archivos JSON de la knowledge base."""
    brand_docs = []
    brand_ids = []
    brand_metas = []

    seasonal_docs = []
    seasonal_ids = []
    seasonal_metas = []

    files_to_index = [
        "brand_identity.json",
        "product_catalog.json",
        "buyer_personas.json",
        "content_pillars.json",
        "hashtag_library.json",
    ]

    for filename in files_to_index:
        filepath = KB_DIR / filename
        if not filepath.exists():
            continue
        with open(filepath) as f:
            data = json.load(f)

        chunks = _chunk_json(data, filename)
        for i, chunk in enumerate(chunks):
            brand_docs.append(chunk)
            brand_ids.append(f"{filename}_{i}")
            brand_metas.append({"source": filename, "chunk_index": i})

    # Seasonal calendar indexed separately
    seasonal_path = KB_DIR / "seasonal_calendar.json"
    if seasonal_path.exists():
        with open(seasonal_path) as f:
            seasonal_data = json.load(f)
        for i, event in enumerate(seasonal_data.get("events", [])):
            seasonal_docs.append(json.dumps(event, ensure_ascii=False))
            seasonal_ids.append(f"seasonal_{i}")
            seasonal_metas.append({"source": "seasonal_calendar.json", "event_type": event.get("type", "")})

    if brand_docs:
        _brand_collection.add(documents=brand_docs, ids=brand_ids, metadatas=brand_metas)

    if seasonal_docs:
        _seasonal_collection.add(documents=seasonal_docs, ids=seasonal_ids, metadatas=seasonal_metas)

    logger.info("indexed", brand_chunks=len(brand_docs), seasonal_events=len(seasonal_docs))


def _chunk_json(data: dict | list, source: str, max_chars: int = 800) -> list[str]:
    """Divide un JSON en chunks de texto para embedding."""
    full_text = json.dumps(data, ensure_ascii=False, indent=2)
    chunks = []
    for i in range(0, len(full_text), max_chars):
        chunks.append(full_text[i:i + max_chars])
    return chunks


async def reindex() -> dict:
    """Re-indexa completamente la knowledge base. Borra y recrea colecciones."""
    try:
        client = _get_chroma()
        client.delete_collection(COLLECTION_NAME)
        client.delete_collection(SEASONAL_COLLECTION)

        global _brand_collection, _seasonal_collection
        _brand_collection = client.get_or_create_collection(name=COLLECTION_NAME)
        _seasonal_collection = client.get_or_create_collection(name=SEASONAL_COLLECTION)

        await _index_all()
        return {"status": "ok", "brand_docs": _brand_collection.count(), "seasonal_docs": _seasonal_collection.count()}
    except Exception as e:
        return {"status": "error", "error": str(e)}

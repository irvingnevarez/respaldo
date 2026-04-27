"""
Recupera contexto relevante de ChromaDB para inyectar en prompts de agentes.
"""

import structlog

logger = structlog.get_logger()


async def retrieve_brand_context(query: str, n_results: int = 5) -> str:
    """
    Busca en la colección de marca y retorna texto relevante.
    Usado por todos los agentes para obtener contexto de marca.
    """
    try:
        from app.knowledge.brand_context import _brand_collection

        if _brand_collection is None or _brand_collection.count() == 0:
            return _fallback_context()

        results = _brand_collection.query(
            query_texts=[query],
            n_results=min(n_results, _brand_collection.count()),
        )

        documents = results.get("documents", [[]])[0]
        return "\n\n---\n\n".join(documents)

    except Exception as e:
        logger.warning("retrieval_failed", error=str(e))
        return _fallback_context()


async def retrieve_seasonal_context(query: str, n_results: int = 3) -> str:
    """Recupera eventos estacionales relevantes."""
    try:
        from app.knowledge.brand_context import _seasonal_collection

        if _seasonal_collection is None or _seasonal_collection.count() == 0:
            return ""

        results = _seasonal_collection.query(
            query_texts=[query],
            n_results=min(n_results, _seasonal_collection.count()),
        )

        documents = results.get("documents", [[]])[0]
        return "\n".join(documents)

    except Exception as e:
        logger.warning("seasonal_retrieval_failed", error=str(e))
        return ""


def _fallback_context() -> str:
    return (
        "Marca: Lummy Designs — serigrafía, DTF y productos personalizados de lujo en México. "
        "Paleta: negro #0a0a0a + dorado #C9A84C. "
        "Tono: cálido, cercano, aspiracional. Siempre 'tú'. "
        "Canal principal de ventas: WhatsApp. "
        "Productos: termos personalizados, sets de regalo, serigrafía en textil, grabado en madera."
    )

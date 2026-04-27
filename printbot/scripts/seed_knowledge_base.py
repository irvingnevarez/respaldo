#!/usr/bin/env python3
"""
Semilla de la base de conocimiento en ChromaDB.
Ejecutar una sola vez después de la instalación o cuando se actualicen los JSONs.

Uso:
    python scripts/seed_knowledge_base.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


async def main():
    from app.knowledge.brand_context import reindex

    print("Indexando knowledge base en ChromaDB...")
    result = await reindex()

    if result["status"] == "ok":
        print(f"✓ Indexación completa: {result['brand_docs']} chunks de marca, {result['seasonal_docs']} eventos estacionales")
    else:
        print(f"✗ Error durante indexación: {result.get('error')}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

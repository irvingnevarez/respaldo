#!/usr/bin/env python3
"""
Setup inicial completo de PrintBot.
Ejecutar UNA SOLA VEZ después de la instalación.

Realiza en orden:
  1. Crea todas las tablas en SQLite
  2. Indexa la knowledge base en ChromaDB
  3. Carga los prompts YAML en DB y activa v1.0 de cada agente

Uso:
    python scripts/setup.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


async def main():
    print("\n🖨️  PrintBot Marketing Agent — Setup Inicial")
    print("=" * 50)

    # 1. Base de datos
    print("\n[1/3] Inicializando base de datos SQLite...")
    from app.db.base import init_db
    await init_db()
    print("  ✓ Tablas creadas")

    # 2. Knowledge base
    print("\n[2/3] Indexando knowledge base en ChromaDB...")
    from app.knowledge.brand_context import reindex
    result = await reindex()
    if result["status"] == "ok":
        print(f"  ✓ {result['brand_docs']} chunks de marca + {result['seasonal_docs']} eventos estacionales")
    else:
        print(f"  ✗ Error: {result.get('error')}")
        sys.exit(1)

    # 3. Prompts
    print("\n[3/3] Cargando prompts versionados...")
    import yaml
    from app.db.base import SessionLocal
    from app.models.prompt_version import PromptVersion
    from sqlalchemy import select

    prompts_dir = Path(__file__).parent.parent / "app" / "prompts"
    loaded = 0

    async with SessionLocal() as db:
        for agent_dir in sorted(prompts_dir.iterdir()):
            if not agent_dir.is_dir():
                continue
            agent_name = agent_dir.name

            for yaml_file in sorted(agent_dir.glob("*.yaml")):
                with open(yaml_file) as f:
                    data = yaml.safe_load(f)

                version = data.get("version", "1.0.0")
                content = data.get("system_prompt", "")

                existing = await db.execute(
                    select(PromptVersion).where(
                        PromptVersion.agent_name == agent_name,
                        PromptVersion.version == version,
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                prev = await db.execute(
                    select(PromptVersion).where(
                        PromptVersion.agent_name == agent_name,
                        PromptVersion.is_active.is_(True),
                    )
                )
                for p in prev.scalars().all():
                    p.is_active = False

                pv = PromptVersion(
                    agent_name=agent_name,
                    version=version,
                    content=content,
                    is_active=True,
                    notes=data.get("changelog", ""),
                )
                db.add(pv)
                await db.commit()
                print(f"  ✓ {agent_name} v{version}")
                loaded += 1

    print(f"\n{'=' * 50}")
    print(f"✅  Setup completo — {loaded} prompts cargados")
    print(f"\nPróximos pasos:")
    print(f"  uvicorn app.main:app --reload")
    print(f"  Swagger UI → http://localhost:8000/docs")
    print(f"  Ver presupuesto → python scripts/check_budget.py\n")


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""
Carga los prompts YAML versionados en la base de datos.
Ejecutar una sola vez después de la instalación o cuando se actualicen los YAMLs.

Uso:
    python scripts/seed_prompts.py
"""

import asyncio
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

PROMPTS_DIR = Path(__file__).parent.parent / "app" / "prompts"


async def main():
    from app.db.base import SessionLocal, init_db
    from app.models.prompt_version import PromptVersion
    from sqlalchemy import select

    await init_db()

    loaded = 0
    async with SessionLocal() as db:
        for agent_dir in sorted(PROMPTS_DIR.iterdir()):
            if not agent_dir.is_dir():
                continue
            agent_name = agent_dir.name

            for yaml_file in sorted(agent_dir.glob("*.yaml")):
                with open(yaml_file) as f:
                    data = yaml.safe_load(f)

                version = data.get("version", "1.0.0")
                content = data.get("system_prompt", "")

                # Verificar si ya existe
                existing = await db.execute(
                    select(PromptVersion).where(
                        PromptVersion.agent_name == agent_name,
                        PromptVersion.version == version,
                    )
                )
                if existing.scalar_one_or_none():
                    print(f"  [skip] {agent_name} v{version} ya existe")
                    continue

                # Desactivar versiones anteriores del mismo agente
                prev_result = await db.execute(
                    select(PromptVersion).where(
                        PromptVersion.agent_name == agent_name,
                        PromptVersion.is_active.is_(True),
                    )
                )
                for prev in prev_result.scalars().all():
                    prev.is_active = False

                prompt = PromptVersion(
                    agent_name=agent_name,
                    version=version,
                    content=content,
                    is_active=True,
                    notes=data.get("changelog", ""),
                )
                db.add(prompt)
                await db.commit()

                print(f"  [ok] {agent_name} v{version} cargado y activado")
                loaded += 1

    print(f"\n✓ {loaded} prompts cargados en base de datos")


if __name__ == "__main__":
    asyncio.run(main())

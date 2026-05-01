#!/usr/bin/env python3
"""
Muestra el estado actual del presupuesto mensual en consola.

Uso:
    python scripts/check_budget.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


async def main():
    from app.db.base import SessionLocal, init_db
    from app.services.budget_tracker import get_budget_status

    await init_db()

    async with SessionLocal() as db:
        status = await get_budget_status(db)

    icons = {"ok": "✅", "warning": "⚠️", "critical": "🚨"}
    icon = icons.get(status["status"], "❓")

    print(f"\n{icon}  PrintBot — Estado del Presupuesto Mensual")
    print(f"{'─' * 45}")
    print(f"  Presupuesto total:  ${status['monthly_budget_usd']:.2f} USD")
    print(f"  Gastado este mes:   ${status['spent_usd']:.4f} USD  ({status['usage_pct']}%)")
    print(f"  Disponible:         ${status['remaining_usd']:.4f} USD")
    print(f"  Alerta a:           ${status['alert_threshold_usd']:.2f} USD")
    print(f"  Hard stop a:        ${status['hard_stop_usd']:.2f} USD")
    print(f"  Estado:             {status['status'].upper()}")
    print(f"{'─' * 45}\n")

    if status["status"] == "critical":
        print("🚨 HARD STOP ALCANZADO — El agente no generará más contenido este mes.")
        sys.exit(1)
    elif status["status"] == "warning":
        print("⚠️  Más del 70% del presupuesto usado. Considera reducir la frecuencia de posts.")


if __name__ == "__main__":
    asyncio.run(main())

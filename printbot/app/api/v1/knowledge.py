import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

KB_DIR = Path(__file__).parent.parent.parent.parent / "knowledge_base"


@router.get("/files")
async def list_files():
    if not KB_DIR.exists():
        return []
    return [f.name for f in KB_DIR.glob("*.json")]


@router.get("/files/{filename}")
async def get_file(filename: str):
    path = KB_DIR / filename
    if not path.exists() or not path.suffix == ".json":
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    with open(path) as f:
        return json.load(f)


@router.put("/files/{filename}")
async def update_file(filename: str, content: dict):
    if not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos JSON")
    path = KB_DIR / filename
    with open(path, "w") as f:
        json.dump(content, f, ensure_ascii=False, indent=2)
    return {"status": "saved"}


@router.post("/reindex")
async def reindex_knowledge():
    """Re-indexa ChromaDB con los archivos JSON actuales."""
    from app.knowledge.brand_context import reindex
    result = await reindex()
    return result

"""
Wrapper para Cloudinary — subida de imágenes y videos.
Usa free tier (25GB storage / 25GB bandwidth por mes).
"""

import asyncio
from pathlib import Path

import structlog

logger = structlog.get_logger()


def _init_cloudinary():
    import cloudinary
    from app.config import settings

    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


async def upload_from_url(url: str, folder: str = "printbot") -> str | None:
    """Sube una imagen desde URL a Cloudinary. Retorna la URL de Cloudinary."""
    try:
        _init_cloudinary()
        import cloudinary.uploader

        result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            url,
            folder=folder,
            resource_type="image",
        )
        cdn_url = result.get("secure_url")
        logger.info("cloudinary_upload_done", url=cdn_url)
        return cdn_url
    except Exception as e:
        logger.error("cloudinary_upload_failed", error=str(e))
        return url  # fallback: retorna URL original


async def upload_video(file_path: str | Path, folder: str = "printbot/videos") -> str | None:
    """Sube un archivo de video local a Cloudinary."""
    try:
        _init_cloudinary()
        import cloudinary.uploader

        result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            str(file_path),
            folder=folder,
            resource_type="video",
        )
        cdn_url = result.get("secure_url")
        logger.info("cloudinary_video_upload_done", url=cdn_url)
        return cdn_url
    except Exception as e:
        logger.error("cloudinary_video_upload_failed", error=str(e))
        return None


async def upload_file(file_path: str | Path, folder: str = "printbot") -> str | None:
    """Sube un archivo local genérico a Cloudinary."""
    try:
        _init_cloudinary()
        import cloudinary.uploader

        result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            str(file_path),
            folder=folder,
        )
        return result.get("secure_url")
    except Exception as e:
        logger.error("cloudinary_file_upload_failed", error=str(e))
        return None

"""
Servicio de composición de video con FFmpeg.
Genera videos para Reels/TikTok a partir de VideoScript + plantillas Jinja2.
No usa Runway/Pika — composición 100% programática y gratuita.
"""

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

import structlog
from jinja2 import Environment, FileSystemLoader

logger = structlog.get_logger()

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "video_templates"
OUTPUT_DIR = Path("/tmp/printbot_videos")
OUTPUT_DIR.mkdir(exist_ok=True)


async def render(video_script: dict) -> Path | None:
    """
    Renderiza un VideoScript a MP4 usando FFmpeg.
    Retorna la ruta al archivo generado, o None si falla.
    """
    template_name = video_script.get("template", "reel_product_showcase")
    template_dir = TEMPLATES_DIR / template_name

    if not template_dir.exists():
        template_dir = TEMPLATES_DIR / "reel_product_showcase"

    template_path = template_dir / "template.json"
    if not template_path.exists():
        logger.warning("ffmpeg_template_not_found", template=template_name)
        return None

    try:
        with open(template_path) as f:
            template_config = json.load(f)

        # Combinar script con config de plantilla
        render_context = {**template_config, **video_script}
        duration = video_script.get("duration_seconds", 15)
        scenes = video_script.get("scenes", [])

        # Generar un video simple: imagen estática + texto overlay
        output_path = OUTPUT_DIR / f"video_{id(video_script)}.mp4"

        # Construir filtros FFmpeg para texto
        drawtext_filters = []
        for scene in scenes:
            text = scene.get("text_overlay", "")
            if text:
                clean_text = text.replace("'", "\\'").replace(":", "\\:")
                start = scene.get("start", 0)
                end = scene.get("end", duration)
                drawtext_filters.append(
                    f"drawtext=text='{clean_text}':fontsize=48:fontcolor=white:"
                    f"x=(w-text_w)/2:y=(h-text_h)/2:"
                    f"enable='between(t,{start},{end})'"
                )

        cta_text = video_script.get("final_cta_text", "Escríbenos por WhatsApp")
        clean_cta = cta_text.replace("'", "\\'").replace(":", "\\:")
        drawtext_filters.append(
            f"drawtext=text='{clean_cta}':fontsize=36:fontcolor=#C9A84C:"
            f"x=(w-text_w)/2:y=h-100:"
            f"enable='between(t,{max(0, duration-4)},{duration})'"
        )

        color_overlay = video_script.get("color_overlay", "#0a0a0a80")
        vf_chain = ",".join(drawtext_filters) if drawtext_filters else "null"

        # Comando FFmpeg: genera video desde color sólido negro + textos
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c=black:s=1080x1920:d={duration}",
            "-vf", vf_chain,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            "-t", str(duration),
            str(output_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        except asyncio.TimeoutError:
            process.kill()
            logger.error("ffmpeg_timeout")
            return None

        if process.returncode != 0:
            logger.error("ffmpeg_failed", stderr=stderr.decode()[-500:])
            return None

        logger.info("ffmpeg_render_complete", output=str(output_path), duration=duration)
        return output_path

    except Exception as e:
        logger.error("ffmpeg_service_error", error=str(e))
        return None


async def check_ffmpeg_available() -> bool:
    """Verifica que FFmpeg esté instalado en el sistema."""
    try:
        result = await asyncio.create_subprocess_exec(
            "ffmpeg", "-version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await result.communicate()
        return result.returncode == 0
    except FileNotFoundError:
        return False

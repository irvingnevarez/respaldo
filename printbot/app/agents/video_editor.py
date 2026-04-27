"""
VideoEditorAgent — escribe el guion y orquesta la composición FFmpeg.
Modelo: Haiku 4.5 para guion; ffmpeg_service para render.
No usa Runway/Pika para mantener costo en $0 de video.
"""

import json

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()

TEMPLATE_OPTIONS = [
    "reel_product_showcase",
    "before_after",
    "process_timelapse",
    "testimonial_quote",
]


class VideoEditorAgent(BaseAgent):
    agent_name = "video_editor"

    def __init__(self, client, db, ffmpeg_svc=None, cloudinary_svc=None):
        super().__init__(client, db)
        self.ffmpeg_svc = ffmpeg_svc
        self.cloudinary_svc = cloudinary_svc

    async def run(self, task: AgentTask) -> AgentResult:
        pillar: str = task.inputs.get("pillar", "proceso_artesanal")
        content_idea: str = task.inputs.get("content_idea", "")
        copy_bundle: dict = task.inputs.get("copy_bundle", {})
        image_url: str = task.inputs.get("image_url", "")
        platform: str = task.inputs.get("platform", "instagram")
        brand_context: str = task.inputs.get("brand_context", "")

        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        user_message = f"""Escribe el guion y la configuración para un video Reel/TikTok de 15-30 segundos.

Plataforma: {platform}
Pilar: {pillar}
Idea: {content_idea}
Caption disponible: {copy_bundle.get('hook_line', '')}
CTA: {copy_bundle.get('cta', '')}

Plantillas disponibles: {', '.join(TEMPLATE_OPTIONS)}

Responde SOLO con este JSON:
{{
  "template": "nombre_de_plantilla",
  "duration_seconds": 15,
  "scenes": [
    {{
      "start": 0,
      "end": 3,
      "text_overlay": "Texto en pantalla",
      "animation": "fade_in|slide_up|zoom",
      "image_url": "{image_url}"
    }}
  ],
  "background_music": "upbeat_latin|soft_elegant|none",
  "logo_position": "bottom_right|top_left",
  "color_overlay": "#0a0a0a80",
  "final_cta_text": "Texto del CTA final",
  "whatsapp_number": "Número visible en último frame"
}}
Solo el JSON, sin markdown."""

        try:
            response, cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=user_message,
                max_tokens=800,
                campaign_id=task.campaign_id,
            )

            clean = response.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            video_script = json.loads(clean)

            video_url = None

            if self.ffmpeg_svc:
                output_path = await self.ffmpeg_svc.render(video_script)
                if output_path and self.cloudinary_svc:
                    video_url = await self.cloudinary_svc.upload_video(
                        output_path,
                        folder="printbot/videos",
                    )

            logger.info("video_editor_complete", template=video_script.get("template"), cost_usd=cost)

            return AgentResult(
                success=True,
                data={
                    "video_script": video_script,
                    "video_url": video_url,
                    "media_type": "video",
                },
                cost_usd=cost,
            )

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}")
        except Exception as e:
            return AgentResult(success=False, error=str(e))

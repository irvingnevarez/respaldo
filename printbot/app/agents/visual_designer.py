"""
VisualDesignerAgent — genera prompts DALL-E 3 y llama a la API de imágenes.
Modelo: Haiku 4.5 para generar el prompt; OpenAI DALL-E 3 para la imagen.
Costo: ~$0.040 USD/imagen. Verificar presupuesto antes de cada llamada.
"""

import json

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent
from app.services.budget_tracker import check_budget, record_dalle_usage

logger = structlog.get_logger()


class VisualDesignerAgent(BaseAgent):
    agent_name = "visual_designer"

    def __init__(self, client, db, openai_client=None, cloudinary_svc=None):
        super().__init__(client, db)
        self.openai_client = openai_client
        self.cloudinary_svc = cloudinary_svc

    async def run(self, task: AgentTask) -> AgentResult:
        pillar: str = task.inputs.get("pillar", "producto_terminado")
        content_idea: str = task.inputs.get("content_idea", "")
        product_focus: str = task.inputs.get("product_focus", "termo personalizado")
        platform: str = task.inputs.get("platform", "instagram")
        brand_context: str = task.inputs.get("brand_context", "")

        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        # Paso 1: Haiku genera el prompt DALL-E óptimo
        prompt_request = f"""Genera un prompt detallado para DALL-E 3 que cree una imagen profesional para {platform}.

Pilar de contenido: {pillar}
Idea: {content_idea}
Producto: {product_focus}

El prompt debe:
- Especificar estilo fotográfico (ej: "product photography", "flat lay", "lifestyle shot")
- Incluir la paleta de Lummy Designs: negro profundo #0a0a0a y dorado #C9A84C
- Ser en inglés (DALL-E funciona mejor en inglés)
- Tener máximo 400 caracteres

Responde SOLO con el prompt, sin explicación."""

        try:
            dalle_prompt, prompt_cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=prompt_request,
                max_tokens=300,
                campaign_id=task.campaign_id,
            )
            dalle_prompt = dalle_prompt.strip()

            total_cost = prompt_cost

            # Paso 2: Llamar a DALL-E 3 si el cliente está disponible
            image_url = None
            cloudinary_url = None

            if self.openai_client:
                await check_budget(self.db, 0.040)

                img_response = await self.openai_client.images.generate(
                    model="dall-e-3",
                    prompt=dalle_prompt,
                    size="1024x1024",
                    quality="standard",
                    n=1,
                )
                image_url = img_response.data[0].url

                dalle_cost = await record_dalle_usage(
                    self.db,
                    agent_name=self.agent_name,
                    num_images=1,
                    campaign_id=task.campaign_id,
                )
                total_cost += dalle_cost

                # Paso 3: Subir a Cloudinary si está disponible
                if self.cloudinary_svc and image_url:
                    cloudinary_url = await self.cloudinary_svc.upload_from_url(
                        image_url,
                        folder="printbot/posts",
                    )

            logger.info(
                "visual_designer_complete",
                has_image=image_url is not None,
                cost_usd=total_cost,
            )

            return AgentResult(
                success=True,
                data={
                    "dalle_prompt": dalle_prompt,
                    "image_url": cloudinary_url or image_url,
                    "media_type": "image",
                },
                cost_usd=total_cost,
            )

        except Exception as e:
            return AgentResult(success=False, error=str(e))

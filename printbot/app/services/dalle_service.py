"""
Wrapper para OpenAI DALL-E 3. Incluye retry con backoff y cost tracking.
"""

import asyncio

import structlog
from openai import AsyncOpenAI, RateLimitError

logger = structlog.get_logger()


async def generate_image(
    client: AsyncOpenAI,
    prompt: str,
    size: str = "1024x1024",
    quality: str = "standard",
    retries: int = 3,
) -> str | None:
    """
    Genera una imagen con DALL-E 3 y retorna la URL temporal.
    Retorna None si falla después de todos los reintentos.
    """
    for attempt in range(retries):
        try:
            response = await client.images.generate(
                model="dall-e-3",
                prompt=prompt[:1000],  # DALL-E limit
                size=size,
                quality=quality,
                n=1,
            )
            url = response.data[0].url
            logger.info("dalle_image_generated", size=size, quality=quality)
            return url

        except RateLimitError:
            wait = 2 ** attempt
            logger.warning("dalle_rate_limit", attempt=attempt, wait_seconds=wait)
            await asyncio.sleep(wait)

        except Exception as e:
            logger.error("dalle_error", attempt=attempt, error=str(e))
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)

    return None

"""
BaseAgent — clase abstracta que todos los sub-agentes heredan.
Maneja: selección de modelo, carga de prompts versionados,
conteo de tokens, gate de presupuesto y logging estructurado.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog
import yaml
from anthropic import AsyncAnthropic
from jinja2 import Template
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.budget_tracker import BudgetExceededError, check_budget, record_llm_usage

logger = structlog.get_logger()


@dataclass
class AgentTask:
    task_type: str
    inputs: dict[str, Any] = field(default_factory=dict)
    campaign_id: int | None = None


@dataclass
class AgentResult:
    success: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    cost_usd: float = 0.0
    tokens_used: int = 0


PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class BaseAgent(ABC):
    agent_name: str = "base"
    default_model: str = settings.subagent_model

    def __init__(self, client: AsyncAnthropic, db: AsyncSession):
        self.client = client
        self.db = db
        self.log = structlog.get_logger(agent=self.agent_name)

    async def get_system_prompt(self, variables: dict[str, Any] | None = None) -> str:
        """
        Carga el prompt activo desde DB; fallback a YAML en disco.
        Renderiza variables Jinja2 si se proporcionan.
        """
        from sqlalchemy import select

        from app.models.prompt_version import PromptVersion

        result = await self.db.execute(
            select(PromptVersion)
            .where(
                PromptVersion.agent_name == self.agent_name,
                PromptVersion.is_active.is_(True),
            )
            .limit(1)
        )
        version = result.scalar_one_or_none()

        if version:
            prompt_content = version.content
        else:
            yaml_path = PROMPTS_DIR / self.agent_name / "v1.0.yaml"
            if yaml_path.exists():
                with open(yaml_path) as f:
                    data = yaml.safe_load(f)
                prompt_content = data.get("system_prompt", "")
            else:
                prompt_content = f"Eres el agente {self.agent_name} de PrintBot."

        if variables:
            prompt_content = Template(prompt_content).render(**variables)

        return prompt_content

    async def call_claude(
        self,
        system_prompt: str,
        user_message: str,
        max_tokens: int = 1024,
        model: str | None = None,
        campaign_id: int | None = None,
    ) -> tuple[str, float]:
        """
        Llama a la API de Claude con gate de presupuesto.
        Retorna (texto_respuesta, costo_usd).
        """
        model = model or self.default_model

        # Estimación conservadora antes de llamar
        estimated_cost = (len(user_message) / 4) * 0.80e-6 + max_tokens * 4.00e-6
        try:
            await check_budget(self.db, estimated_cost)
        except BudgetExceededError:
            raise

        response = await self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

        content = response.content[0].text
        in_tokens = response.usage.input_tokens
        out_tokens = response.usage.output_tokens

        cost = await record_llm_usage(
            self.db,
            agent_name=self.agent_name,
            model=model,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            task_type=self.agent_name,
            campaign_id=campaign_id,
        )

        self.log.info("claude_call_complete", in_tokens=in_tokens, out_tokens=out_tokens, cost_usd=round(cost, 6))
        return content, cost

    @abstractmethod
    async def run(self, task: AgentTask) -> AgentResult:
        ...

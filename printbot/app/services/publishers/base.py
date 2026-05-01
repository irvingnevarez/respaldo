from abc import ABC, abstractmethod


class BasePublisher(ABC):
    @abstractmethod
    async def publish(self, post) -> str | None:
        """Publica el post. Retorna el ID de la plataforma o None si falla."""
        ...

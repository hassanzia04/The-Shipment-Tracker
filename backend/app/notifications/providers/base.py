from abc import ABC, abstractmethod


class EmailProvider(ABC):
    @abstractmethod
    async def send(self, to: str, subject: str, html_body: str, cc: list[str] | None = None) -> None:
        pass

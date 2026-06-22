from abc import ABC, abstractmethod


class EmailProvider(ABC):
    @abstractmethod
    async def send(
        self,
        to: str | list[str],
        subject: str,
        html_body: str,
        cc: list[str] | None = None,
        attachments: list[tuple[str, bytes]] | None = None,
    ) -> None:
        pass

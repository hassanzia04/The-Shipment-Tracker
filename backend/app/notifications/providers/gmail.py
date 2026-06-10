import base64
import json
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from app.notifications.providers.base import EmailProvider
from app.config import settings

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailProvider(EmailProvider):
    def _get_service(self):
        creds = None

        # Priority 1: GMAIL_TOKEN_DATA env var (JSON string) — preferred for production
        # so the token is not stored on the container filesystem.
        if settings.GMAIL_TOKEN_DATA:
            creds = Credentials.from_authorized_user_info(
                json.loads(settings.GMAIL_TOKEN_DATA), SCOPES
            )

        # Priority 2: token file on disk — used in development with volume mount
        if not creds:
            token_path = settings.GMAIL_TOKEN_JSON
            if os.path.exists(token_path):
                creds = Credentials.from_authorized_user_file(token_path, SCOPES)

        if not creds:
            raise RuntimeError(
                "Gmail credentials not configured. "
                "Set GMAIL_TOKEN_DATA env var (production) or generate credentials/gmail_token.json (development)."
            )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Persist the refreshed token only when using file-based storage.
            # Env-var mode keeps the refreshed token in-memory for this container lifetime.
            if not settings.GMAIL_TOKEN_DATA:
                token_path = settings.GMAIL_TOKEN_JSON
                with open(token_path, "w") as f:
                    f.write(creds.to_json())

        if not creds.valid:
            raise RuntimeError("Gmail token is invalid or expired and could not be refreshed.")

        return build("gmail", "v1", credentials=creds)

    async def send(self, to: str | list[str], subject: str, html_body: str, cc: list[str] | None = None) -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.GMAIL_SENDER_EMAIL
        msg["To"] = ", ".join(to) if isinstance(to, list) else to
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg.attach(MIMEText(html_body, "html"))

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        service = self._get_service()
        service.users().messages().send(userId="me", body={"raw": raw}).execute()


def get_email_provider() -> EmailProvider:
    if settings.EMAIL_PROVIDER == "gmail":
        return GmailProvider()
    if settings.EMAIL_PROVIDER == "smtp":
        from app.notifications.providers.smtp import SmtpProvider
        return SmtpProvider()
    raise ValueError(f"Unknown email provider: {settings.EMAIL_PROVIDER}")

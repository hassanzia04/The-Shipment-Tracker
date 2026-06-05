import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.notifications.providers.base import EmailProvider
from app.config import settings


class SmtpProvider(EmailProvider):
    async def send(self, to: str, subject: str, html_body: str, cc: list[str] | None = None) -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_SENDER_EMAIL
        msg["To"] = to
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            recipients = [to] + (cc or [])
            server.sendmail(settings.SMTP_SENDER_EMAIL, recipients, msg.as_string())

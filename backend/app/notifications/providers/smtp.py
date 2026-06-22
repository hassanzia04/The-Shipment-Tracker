import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.notifications.providers.base import EmailProvider
from app.config import settings


class SmtpProvider(EmailProvider):
    async def send(
        self,
        to: str | list[str],
        subject: str,
        html_body: str,
        cc: list[str] | None = None,
        attachments: list[tuple[str, bytes]] | None = None,
    ) -> None:
        to_list = to if isinstance(to, list) else [to]

        if attachments:
            msg = MIMEMultipart("mixed")
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(html_body, "html"))
            msg.attach(alt)
            for filename, data in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(data)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=filename)
                msg.attach(part)
        else:
            msg = MIMEMultipart("alternative")
            msg.attach(MIMEText(html_body, "html"))

        msg["Subject"] = subject
        msg["From"] = settings.SMTP_SENDER_EMAIL
        msg["To"] = ", ".join(to_list)
        if cc:
            msg["Cc"] = ", ".join(cc)

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            recipients = to_list + (cc or [])
            server.sendmail(settings.SMTP_SENDER_EMAIL, recipients, msg.as_string())

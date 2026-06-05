from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    OCI_ENDPOINT_URL: str = ""
    OCI_ACCESS_KEY: str = ""
    OCI_SECRET_KEY: str = ""
    OCI_BUCKET_NAME: str = "ffd-documents"
    OCI_REGION: str = "me-dubai-1"
    OCI_NAMESPACE: str = ""

    EMAIL_PROVIDER: str = "gmail"
    GMAIL_CREDENTIALS_JSON: str = "credentials/gmail_credentials.json"
    GMAIL_TOKEN_JSON: str = "credentials/gmail_token.json"
    # In production, set this to the full JSON content of the token file so the
    # token does not need to live on the container filesystem.
    GMAIL_TOKEN_DATA: str = ""
    GMAIL_SENDER_EMAIL: str = ""

    # SMTP provider settings (Outlook / Office 365 / any SMTP server)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_SENDER_EMAIL: str = ""
    SMTP_USE_TLS: bool = True

    ANTHROPIC_API_KEY: str = ""

    FRONTEND_URL: str = "http://localhost:3000"
    INVITATION_EXPIRE_HOURS: int = 48
    ENVIRONMENT: str = "development"
    MAX_UPLOAD_SIZE_MB: int = 20


settings = Settings()

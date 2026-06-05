"""
Run this script ONCE locally to generate gmail_token.json.

Steps:
1. Place gmail_credentials.json in backend/credentials/
2. Run: python generate_gmail_token.py
3. A browser window opens — log in with the Gmail account that will send emails
4. After approving, token is saved to backend/credentials/gmail_token.json
5. Copy the contents of that file into GMAIL_TOKEN_DATA in .env.prod on the server
"""

import json
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
CREDENTIALS_FILE = Path(__file__).parent / "credentials" / "gmail_credentials.json"
TOKEN_FILE = Path(__file__).parent / "credentials" / "gmail_token.json"

if not CREDENTIALS_FILE.exists():
    print(f"ERROR: {CREDENTIALS_FILE} not found.")
    print("Download it from Google Cloud Console → Credentials → your OAuth client → Download JSON")
    raise SystemExit(1)

flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
creds = flow.run_local_server(port=0)

TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
TOKEN_FILE.write_text(creds.to_json())

print(f"\nToken saved to: {TOKEN_FILE}")
print("\n--- Copy the following into GMAIL_TOKEN_DATA in .env.prod on your server ---\n")
print(creds.to_json())
print("\n--- End of token ---")
print(f"\nAlso set GMAIL_SENDER_EMAIL=<the Gmail address you just authorized>")

import asyncio
from app.database import AsyncSessionLocal
from app.auth.models import User
from app.enums import Team
from app.auth.service import hash_password

async def main():
    async with AsyncSessionLocal() as db:
        u = User(full_name="Admin", email="admin@test.com", hashed_password=hash_password("admin123"), team=Team.FFD, is_admin=True, is_active=True)
        db.add(u)
        await db.commit()
        print("Done: admin@test.com / admin123")

asyncio.run(main())

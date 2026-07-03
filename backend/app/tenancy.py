"""Company-level tenant scoping for customer-team users.

Customer-team users (CUSTOMER, CUSTOMER_MANAGEMENT) only ever see data
belonging to their own company. Internal teams and admins are unscoped and
may optionally request a specific company via filters.
"""
import uuid

from fastapi import HTTPException

from app.auth.models import User
from app.enums import Team

CUSTOMER_TEAMS = {Team.CUSTOMER, Team.CUSTOMER_MANAGEMENT}


def is_customer_user(actor: User) -> bool:
    return actor.team in CUSTOMER_TEAMS and not actor.is_admin


def company_scope(actor: User) -> uuid.UUID | None:
    """Company id to enforce for customer-team users; None = unscoped."""
    if is_customer_user(actor):
        if actor.company_id is None:
            raise HTTPException(
                status_code=403,
                detail="Your account is not linked to a company. Contact an administrator.",
            )
        return actor.company_id
    return None


def effective_company_filter(actor: User, requested: uuid.UUID | None) -> uuid.UUID | None:
    """For list endpoints: customer users are forced to their own company;
    internal users may request any company (or none)."""
    return company_scope(actor) or requested

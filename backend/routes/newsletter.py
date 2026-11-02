"""Newsletter sign-ups from the footer form on every page."""
from flask import Blueprint

from db import get_db
from utils import body, check_email, now, ok, text

bp = Blueprint("newsletter", __name__, url_prefix="/api/newsletter")


@bp.post("")
def subscribe():
    data = body()
    email = check_email(data.get("email"))
    get_db().newsletter.update_one(
        {"email": email},
        {"$set": {"active": True, "updated_at": now()},
         "$setOnInsert": {"subscribed_at": now(), "source": text(data, "source", 60) or "website"}},
        upsert=True)
    return ok({"ok": True, "email": email}, 201)


@bp.post("/unsubscribe")
def unsubscribe():
    email = check_email(body().get("email"))
    get_db().newsletter.update_one({"email": email}, {"$set": {"active": False, "updated_at": now()}})
    return ok()

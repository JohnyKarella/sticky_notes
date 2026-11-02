"""Copy the store data from your local MongoDB into MongoDB Atlas.

Put this file in the backend folder, then run:   python migrate_to_atlas.py

- Reads from:  mongodb://localhost:27017   (what MongoDB Compass shows as localhost:27017)
- Writes to:   MONGO_URI in backend/.env   (your Atlas connection string)
- Database:    MONGO_DB in backend/.env    (notera_store)

It is safe to run more than once: documents are matched by _id and updated,
nothing is deleted. Indexes are created by app.py when the server starts.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient, ReplaceOne

load_dotenv(Path(__file__).resolve().parent / ".env")

LOCAL_URI = os.getenv("LOCAL_MONGO_URI", "mongodb://localhost:27017")
ATLAS_URI = os.getenv("MONGO_URI", "")
DB_NAME = os.getenv("MONGO_DB", "notera_store")

if not ATLAS_URI.startswith("mongodb+srv://"):
    sys.exit("MONGO_URI in backend/.env is not an Atlas address (mongodb+srv://...). Fix .env first.")

local = MongoClient(LOCAL_URI, serverSelectionTimeoutMS=5000)[DB_NAME]
atlas_client = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=10000)
try:
    atlas_client.admin.command("ping")
except Exception as exc:
    sys.exit(f"Cannot reach Atlas. Check the password in MONGO_URI and your IP in Network Access.\n{exc}")
atlas = atlas_client[DB_NAME]

names = [n for n in local.list_collection_names() if not n.startswith("system.")]
if not names:
    sys.exit(f"No collections found in local database '{DB_NAME}'. Is local MongoDB running?")

print(f"Copying '{DB_NAME}' from {LOCAL_URI} to Atlas...")
for name in sorted(names):
    ops = [ReplaceOne({"_id": doc["_id"]}, doc, upsert=True) for doc in local[name].find()]
    if ops:
        atlas[name].bulk_write(ops, ordered=False)
    print(f"  {name:<14} {len(ops):>5} documents")

print("Done. Now start the site with:  python app.py")

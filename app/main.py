"""
QueryMind — AI SQL Assistant
Main FastAPI application with all routes.
"""

import os
import json
import uuid
import hashlib
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import Optional

from app import ai_service, db_manager

app = FastAPI(title="AI SQL Assistant — QueryMind", version="3.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Simple in-memory user store (replace with DB in production)
users_db: dict = {}
sessions_db: dict = {}


# ── Request / Response Models ─────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class SQLGenerateRequest(BaseModel):
    question: str
    db_schema: str = ""
    dialect: str = "PostgreSQL"
    session_token: str = ""

class SQLExplainRequest(BaseModel):
    sql: str
    dialect: str = "PostgreSQL"
    session_token: str = ""

class SQLFixRequest(BaseModel):
    sql: str
    error_message: str = ""
    dialect: str = "PostgreSQL"
    session_token: str = ""

class SQLOptimizeRequest(BaseModel):
    sql: str
    dialect: str = "PostgreSQL"
    db_schema: str = ""
    session_token: str = ""

class SQLToNLRequest(BaseModel):
    sql: str
    session_token: str = ""

class SuggestionsRequest(BaseModel):
    question: str
    sql: str = ""
    db_schema: str = ""
    session_token: str = ""

class InsightsRequest(BaseModel):
    sql: str
    results: list = []
    columns: list = []
    session_token: str = ""

class FollowupRequest(BaseModel):
    question: str
    sql: str = ""
    db_schema: str = ""
    session_token: str = ""

class ValidateRequest(BaseModel):
    question: str
    sql: str
    db_schema: str = ""
    dialect: str = "PostgreSQL"
    session_token: str = ""

class DBConnectRequest(BaseModel):
    db_type: str
    host: str = "localhost"
    port: int = 5432
    database: str = ""
    username: str = ""
    password: str = ""
    session_token: str = ""

class DBExecuteRequest(BaseModel):
    sql: str
    page: int = 1
    page_size: int = 50
    sort_column: str = ""
    sort_direction: str = "asc"
    filters: dict = {}
    session_token: str = ""

class ClearConversationRequest(BaseModel):
    session_token: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def _require_auth(session_token: str) -> str:
    """Validate session token and return email. Raises 401 if invalid."""
    if not session_token or session_token not in sessions_db:
        raise HTTPException(status_code=401, detail="Please sign in first.")
    return sessions_db[session_token]


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/app", response_class=HTMLResponse)
async def sql_app(request: Request):
    return templates.TemplateResponse("app.html", {"request": request})


# ── Auth Routes ────────────────────────────────────────────────────────────────

@app.post("/auth/register")
async def register(req: RegisterRequest):
    if req.email in users_db:
        raise HTTPException(status_code=400, detail="Email already registered.")
    user_id = str(uuid.uuid4())
    users_db[req.email] = {
        "id": user_id,
        "name": req.name,
        "email": req.email,
        "password": hash_password(req.password),
    }
    token = str(uuid.uuid4())
    sessions_db[token] = req.email
    return {"token": token, "name": req.name, "email": req.email}

@app.post("/auth/login")
async def login(req: LoginRequest):
    user = users_db.get(req.email)
    if not user or user["password"] != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = str(uuid.uuid4())
    sessions_db[token] = req.email
    return {"token": token, "name": user["name"], "email": req.email}

@app.post("/auth/logout")
async def logout(body: dict):
    token = body.get("token", "")
    sessions_db.pop(token, None)
    ai_service.clear_conversation(token)
    db_manager.disconnect_db(token)
    return {"status": "logged out"}


# ── Feature 4: Natural Language → SQL (Enhanced) ─────────────────────────────

@app.post("/generate")
async def generate_sql(req: SQLGenerateRequest):
    _require_auth(req.session_token)

    # If connected to a DB and no schema provided, use live schema
    schema = req.db_schema
    if not schema and db_manager.is_connected(req.session_token):
        schema_data = db_manager.get_schema(req.session_token)
        schema = schema_data.get("schema_text", "")

    result = ai_service.generate_sql(
        question=req.question,
        schema=schema,
        dialect=req.dialect,
        session_token=req.session_token,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 1: SQL Explainer ────────────────────────────────────────────────

@app.post("/explain")
async def explain_sql(req: SQLExplainRequest):
    _require_auth(req.session_token)
    result = ai_service.explain_sql(req.sql, req.dialect)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 2: SQL Error Fixer ──────────────────────────────────────────────

@app.post("/fix")
async def fix_sql(req: SQLFixRequest):
    _require_auth(req.session_token)
    result = ai_service.fix_sql(req.sql, req.error_message, req.dialect)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 3: SQL Optimizer ────────────────────────────────────────────────

@app.post("/optimize")
async def optimize_sql(req: SQLOptimizeRequest):
    _require_auth(req.session_token)
    result = ai_service.optimize_sql(req.sql, req.dialect, req.db_schema)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 5: SQL → Natural Language ───────────────────────────────────────

@app.post("/sql-to-nl")
async def sql_to_nl(req: SQLToNLRequest):
    _require_auth(req.session_token)
    result = ai_service.sql_to_natural_language(req.sql)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 6: AI Query Suggestions ─────────────────────────────────────────

@app.post("/suggestions")
async def get_suggestions(req: SuggestionsRequest):
    _require_auth(req.session_token)
    schema = req.db_schema
    if not schema and db_manager.is_connected(req.session_token):
        schema_data = db_manager.get_schema(req.session_token)
        schema = schema_data.get("schema_text", "")
    result = ai_service.get_suggestions(req.question, req.sql, schema)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 7: AI Data Insights ─────────────────────────────────────────────

@app.post("/insights")
async def get_insights(req: InsightsRequest):
    _require_auth(req.session_token)
    result = ai_service.get_data_insights(req.sql, req.results, req.columns)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 8: AI Follow-up Questions ───────────────────────────────────────

@app.post("/followup")
async def get_followup(req: FollowupRequest):
    _require_auth(req.session_token)
    schema = req.db_schema
    if not schema and db_manager.is_connected(req.session_token):
        schema_data = db_manager.get_schema(req.session_token)
        schema = schema_data.get("schema_text", "")
    result = ai_service.get_followup_questions(req.question, req.sql, schema)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 9: AI Query Validation ──────────────────────────────────────────

@app.post("/validate")
async def validate_query(req: ValidateRequest):
    _require_auth(req.session_token)
    result = ai_service.validate_query(req.question, req.sql, req.db_schema, req.dialect)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result.get("raw", result["error"]))
    return result


# ── Feature 10: Multi-turn Conversation ─────────────────────────────────────

@app.post("/conversation/clear")
async def clear_conversation(req: ClearConversationRequest):
    _require_auth(req.session_token)
    ai_service.clear_conversation(req.session_token)
    return {"status": "cleared"}

@app.get("/conversation/history")
async def get_conversation_history(session_token: str = ""):
    _require_auth(session_token)
    history = ai_service.get_conversation_context(session_token)
    return {"history": history}


# ── Features 11-13: Database Connection ─────────────────────────────────────

@app.post("/db/connect")
async def connect_db(req: DBConnectRequest):
    _require_auth(req.session_token)
    result = db_manager.connect_db(
        session_id=req.session_token,
        db_type=req.db_type,
        host=req.host,
        port=req.port,
        database=req.database,
        username=req.username,
        password=req.password,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result

@app.post("/db/disconnect")
async def disconnect_db(body: dict):
    token = body.get("session_token", "")
    _require_auth(token)
    return db_manager.disconnect_db(token)

@app.get("/db/status")
async def db_status(session_token: str = ""):
    _require_auth(session_token)
    return db_manager.get_connection_info(session_token)


# ── Feature 14-15: Schema Import & Analysis ─────────────────────────────────

@app.get("/db/schema")
async def get_schema(session_token: str = ""):
    _require_auth(session_token)
    if not db_manager.is_connected(session_token):
        raise HTTPException(status_code=400, detail="Not connected to any database.")
    return db_manager.get_schema(session_token)


# ── Feature 16: Table & Column Explorer ──────────────────────────────────────

@app.get("/db/tables")
async def get_tables(session_token: str = ""):
    _require_auth(session_token)
    if not db_manager.is_connected(session_token):
        raise HTTPException(status_code=400, detail="Not connected to any database.")
    return {"tables": db_manager.get_tables(session_token)}

@app.get("/db/tables/{table_name}")
async def get_table_details(table_name: str, session_token: str = ""):
    _require_auth(session_token)
    if not db_manager.is_connected(session_token):
        raise HTTPException(status_code=400, detail="Not connected to any database.")
    result = db_manager.get_table_details(session_token, table_name)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Feature 17: Foreign-Key / Relationship Detection ────────────────────────

@app.get("/db/relationships")
async def get_relationships(session_token: str = ""):
    _require_auth(session_token)
    if not db_manager.is_connected(session_token):
        raise HTTPException(status_code=400, detail="Not connected to any database.")
    return {"relationships": db_manager.get_relationships(session_token)}


# ── Feature 18: ER Diagram ──────────────────────────────────────────────────

@app.get("/db/er-diagram")
async def get_er_diagram(session_token: str = ""):
    _require_auth(session_token)
    if not db_manager.is_connected(session_token):
        raise HTTPException(status_code=400, detail="Not connected to any database.")
    return db_manager.get_er_diagram_data(session_token)


# ── Feature 19-20: Live Query Execution & Result Preview ────────────────────

@app.post("/db/execute")
async def execute_query(req: DBExecuteRequest):
    _require_auth(req.session_token)
    if not db_manager.is_connected(req.session_token):
        raise HTTPException(status_code=400, detail="Connect to a database first to execute queries.")
    result = db_manager.execute_query(
        session_id=req.session_token,
        sql=req.sql,
        page=req.page,
        page_size=req.page_size,
        sort_column=req.sort_column,
        sort_direction=req.sort_direction,
        filters=req.filters if req.filters else None,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    api_key = os.getenv("GROQ_API_KEY")
    return {"status": "ok", "api_key_loaded": bool(api_key), "version": "3.0.0"}

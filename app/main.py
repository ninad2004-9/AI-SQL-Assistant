import os
import json
import uuid
import hashlib
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from groq import Groq

app = FastAPI(title="AI SQL Assistant", version="2.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Simple in-memory user store (replace with DB in production)
users_db: dict = {}
sessions_db: dict = {}


# ── Auth Models ────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class SQLRequest(BaseModel):
    question: str
    db_schema: str = ""
    dialect: str = "PostgreSQL"
    session_token: str = ""

class SQLResponse(BaseModel):
    sql: str
    explanation: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_user_from_session(token: str):
    return sessions_db.get(token)


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
    return {"status": "logged out"}


# ── SQL Generation ─────────────────────────────────────────────────────────────

@app.post("/generate", response_model=SQLResponse)
async def generate_sql(req: SQLRequest):
    if not req.session_token or not get_user_from_session(req.session_token):
        raise HTTPException(status_code=401, detail="Please sign in to generate SQL.")

    system_prompt = f"""You are an expert SQL query generator. Convert plain English into valid {req.dialect} SQL.
{f"The database schema is:\\n{req.db_schema}" if req.db_schema else "Infer reasonable table and column names from the question."}

Respond ONLY with a JSON object (no markdown, no backticks) in this exact format:
{{"sql": "the SQL query here", "explanation": "a brief one-sentence explanation of what the query does"}}"""

    message = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.question},
        ],
        max_tokens=1024,
    )

    raw = message.choices[0].message.content.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"Failed to parse response: {raw}")

    return SQLResponse(sql=parsed["sql"], explanation=parsed["explanation"])


@app.get("/health")
async def health():
    api_key = os.getenv("GROQ_API_KEY")
    return {"status": "ok", "api_key_loaded": bool(api_key)}

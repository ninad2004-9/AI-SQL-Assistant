# QueryMind — AI SQL Assistant v2

Convert plain English into SQL queries. Dark animated UI with user auth.

## Tech Stack
- **Backend**: Python · FastAPI · Groq SDK (Llama 3.3 70B)
- **Frontend**: Vanilla JS · HTML/CSS · Canvas animations
- **Auth**: Session-based (in-memory, swap for DB in production)

## Setup

```bash
cd ai-sql-v2
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Create `.env` in the project root:
```
GROQ_API_KEY=your-groq-key-here
```

Run:
```bash
uvicorn app.main:app --reload
```

Open http://localhost:8000

## Features
- Animated particle background with mouse interaction
- Sign up / Sign in with session tokens
- SQL generation with typewriter animation
- Query history in sidebar
- 5 SQL dialects
- Copy to clipboard
- Collapsible sidebar

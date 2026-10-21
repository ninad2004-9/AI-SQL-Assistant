"""
Persistent User Database Module
Stores user credentials, active sessions, and query history in SQLite database.
"""

import os
import uuid
import hashlib
import sqlite3
from datetime import datetime
from typing import Optional, Dict, List, Any

DB_FILE = os.path.join(os.getcwd(), "querymind_users.db")


def get_db_connection() -> sqlite3.Connection:
    """Create and return a database connection with dict-like row access."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_user_db() -> None:
    """Initialize database tables for users, sessions, and query history."""
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                email TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                question TEXT NOT NULL,
                sql_query TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_history_user ON user_history(user_id);
        """)


def hash_password(password: str) -> str:
    """Hash password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()


def register_user(name: str, email: str, password: str) -> Dict[str, Any]:
    """
    Register a new user in the persistent database.
    Raises ValueError if email is already registered.
    """
    email_clean = email.strip().lower()
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(password)

    with get_db_connection() as conn:
        # Check existing
        cursor = conn.execute("SELECT id FROM users WHERE email = ?", (email_clean,))
        if cursor.fetchone():
            raise ValueError("Email already registered.")

        conn.execute(
            "INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)",
            (user_id, name.strip(), email_clean, pw_hash)
        )

        # Create session
        token = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sessions (token, user_id, email) VALUES (?, ?, ?)",
            (token, user_id, email_clean)
        )

    return {
        "id": user_id,
        "token": token,
        "name": name.strip(),
        "email": email_clean
    }


def authenticate_user(email: str, password: str) -> Dict[str, Any]:
    """
    Authenticate user with email and password.
    Returns user details and a new session token.
    Raises ValueError on invalid credentials.
    """
    email_clean = email.strip().lower()
    pw_hash = hash_password(password)

    with get_db_connection() as conn:
        cursor = conn.execute(
            "SELECT id, name, email, password_hash FROM users WHERE email = ?",
            (email_clean,)
        )
        row = cursor.fetchone()
        if not row or row["password_hash"] != pw_hash:
            raise ValueError("Invalid email or password.")

        user_id = row["id"]
        user_name = row["name"]

        # Create session
        token = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sessions (token, user_id, email) VALUES (?, ?, ?)",
            (token, user_id, email_clean)
        )

    return {
        "id": user_id,
        "token": token,
        "name": user_name,
        "email": email_clean
    }


def get_or_create_demo_user() -> Dict[str, Any]:
    """Get or create demo guest user and return valid session token."""
    demo_email = "demo@querymind.ai"
    with get_db_connection() as conn:
        cursor = conn.execute("SELECT id, name, email FROM users WHERE email = ?", (demo_email,))
        row = cursor.fetchone()
        if not row:
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)",
                (user_id, "Demo Explorer", demo_email, hash_password("demo123456"))
            )
        else:
            user_id = row["id"]

        token = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sessions (token, user_id, email) VALUES (?, ?, ?)",
            (token, user_id, demo_email)
        )

    return {
        "id": user_id,
        "token": token,
        "name": "Demo Explorer",
        "email": demo_email
    }



def get_user_by_session(token: str) -> Optional[Dict[str, Any]]:
    """Look up user information by session token."""
    if not token:
        return None

    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT u.id, u.name, u.email, s.token, s.created_at as session_created_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
        """, (token,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict(row)


def delete_session(token: str) -> bool:
    """Delete a session on logout."""
    if not token:
        return False
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return cursor.rowcount > 0


def save_query_history(user_id: str, question: str, sql_query: str) -> None:
    """Save an executed/generated query to user history in the database."""
    if not user_id or not question or not sql_query:
        return
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO user_history (user_id, question, sql_query) VALUES (?, ?, ?)",
            (user_id, question.strip(), sql_query.strip())
        )


def get_user_query_history(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Retrieve the recent query history for a user."""
    if not user_id:
        return []
    with get_db_connection() as conn:
        cursor = conn.execute(
            "SELECT id, question, sql_query, created_at FROM user_history WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit)
        )
        return [dict(row) for row in cursor.fetchall()]


def clear_user_query_history(user_id: str) -> None:
    """Clear query history for a user."""
    if not user_id:
        return
    with get_db_connection() as conn:
        conn.execute("DELETE FROM user_history WHERE user_id = ?", (user_id,))


# Auto-initialize user database tables on import
init_user_db()

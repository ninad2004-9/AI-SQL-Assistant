"""
Database Manager Module — Features 11-20
Handles database connectivity, schema introspection, query execution.
Supports PostgreSQL, MySQL, and SQLite via SQLAlchemy.
"""

import os
import math
from typing import Any
from urllib.parse import quote_plus
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


# ── Connection store: session_token -> {engine, db_type, db_name} ────────────
_connections: dict[str, dict] = {}


def _build_url(db_type: str, host: str, port: int, database: str, username: str, password: str) -> str:
    # If the user pasted a complete connection URI into host or database:
    candidate = host.strip() if ("://" in host) else (database.strip() if ("://" in database) else None)
    if candidate:
        if candidate.startswith("postgres://"):
            return "postgresql+psycopg2://" + candidate[len("postgres://"):]
        if candidate.startswith("postgresql://"):
            return "postgresql+psycopg2://" + candidate[len("postgresql://"):]
        if candidate.startswith("mysql://"):
            return "mysql+pymysql://" + candidate[len("mysql://"):]
        if candidate.startswith("sqlite://"):
            return candidate

    user_part = quote_plus(username) if username else ""
    pass_part = quote_plus(password) if password else ""
    if user_part and pass_part:
        auth = f"{user_part}:{pass_part}@"
    elif user_part:
        auth = f"{user_part}@"
    else:
        auth = ""

    if db_type == "postgresql":
        is_local = host.strip().lower() in ("localhost", "127.0.0.1", "::1")
        db_part = database
        # Cloud PostgreSQL providers (Neon, Supabase, AWS RDS, Render, Railway) require SSL
        if not is_local and db_part and ("?" not in db_part):
            db_part = f"{db_part}?sslmode=require"
        return f"postgresql+psycopg2://{auth}{host}:{port}/{db_part}"
    elif db_type == "mysql":
        return f"mysql+pymysql://{auth}{host}:{port}/{database}"
    elif db_type == "sqlite":
        if database.lower() in ("customer_behavior", "customer_behavior.db"):
            path = os.path.join(os.getcwd(), "customer_behavior.db")
        elif database.lower() in ("sample_store", "sample_store.db"):
            path = os.path.join(os.getcwd(), "sample_store.db")
        else:
            path = database if database else ":memory:"
        return f"sqlite:///{path}"
    raise ValueError(f"Unsupported database type: {db_type}")


def _format_connection_error(e: Exception, db_type: str, host: str, port: int, database: str, username: str) -> str:
    msg = str(e)
    low = msg.lower()
    if "connection refused" in low or "is the server running" in low:
        is_local = host.strip().lower() in ("localhost", "127.0.0.1", "::1")
        if database.lower() in ("customer_behavior", "customer_behavior.db") and is_local:
            cloud_advice = (
                "\n\n⚡ Instant Fix: 'customer_behavior' is already bundled directly inside this project!"
                "\n👉 Click the '⚡ Customer Behavior DB (3,900 Rows)' button in the modal to load it instantly on your deployed app!"
            )
        elif is_local:
            cloud_advice = (
                "\n• If this app is deployed online (Render, Railway, Vercel, etc.): 'localhost' refers to the cloud server, NOT your personal laptop! "
                "Your local PostgreSQL cannot be reached at 'localhost' from the cloud. Use a cloud database (like Neon or Supabase), or click '⚡ Customer Behavior DB' / '⚡ Use Demo DB'."
            )
        else:
            cloud_advice = ""
        return (
            f"Could not connect to {db_type} at {host}:{port} (Connection Refused).\n"
            f"The database server appears to be stopped or not accepting connections.\n"
            f"• If running locally on Windows: open Services (services.msc) and ensure 'postgresql-x64-17' is Running.{cloud_advice}"
        )
    if "password authentication failed" in low or "access denied" in low:
        return (
            f"Authentication failed for user '{username}'. Please verify your username and password for database '{database}'."
        )
    if "database" in low and ("does not exist" in low or "unknown database" in low):
        return f"Database '{database}' does not exist on {host}:{port}."
    return msg


# ──────────────────────────────────────────────────────────────────────────────
# Features 11-13: PostgreSQL / MySQL / SQLite Connection
# ──────────────────────────────────────────────────────────────────────────────
def connect_db(
    session_id: str,
    db_type: str,
    host: str = "localhost",
    port: int = 5432,
    database: str = "",
    username: str = "",
    password: str = "",
) -> dict:
    """
    Connect to a database.
    db_type: 'postgresql' | 'mysql' | 'sqlite'
    For SQLite, 'database' is the file path (or ':memory:').
    """
    if db_type not in ("postgresql", "mysql", "sqlite"):
        return {"status": "error", "message": f"Unsupported database type: {db_type}"}

    hosts_to_try = [host]
    if host.strip().lower() == "localhost":
        hosts_to_try.append("127.0.0.1")

    last_error = None
    for h in hosts_to_try:
        try:
            url = _build_url(db_type, h, port, database, username, password)
            engine = create_engine(url, pool_pre_ping=True)

            # Test the connection
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))

            _connections[session_id] = {
                "engine": engine,
                "db_type": db_type,
                "db_name": database,
            }

            return {
                "status": "connected",
                "db_type": db_type,
                "database": database,
                "message": f"Successfully connected to {db_type} database: {database}",
            }
        except Exception as e:
            last_error = e
            # Only fall back to next host if it was a network/connection refused error
            err_low = str(e).lower()
            if "connection refused" not in err_low and "could not connect" not in err_low:
                break

    formatted_msg = _format_connection_error(last_error, db_type, host, port, database, username)
    return {"status": "error", "message": formatted_msg}


def disconnect_db(session_id: str) -> dict:
    """Disconnect from the database."""
    conn_info = _connections.pop(session_id, None)
    if conn_info:
        try:
            conn_info["engine"].dispose()
        except Exception:
            pass
        return {"status": "disconnected", "message": "Disconnected from database."}
    return {"status": "not_connected", "message": "No active connection."}


def is_connected(session_id: str) -> bool:
    """Check if a session has an active database connection."""
    return session_id in _connections


def get_connection_info(session_id: str) -> dict:
    """Get current connection info."""
    info = _connections.get(session_id)
    if not info:
        return {"connected": False}
    return {
        "connected": True,
        "db_type": info["db_type"],
        "db_name": info["db_name"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Feature 14 & 15: Database Schema Import & Automatic Schema Analysis
# ──────────────────────────────────────────────────────────────────────────────
def get_schema(session_id: str) -> dict:
    """
    Get the full database schema — tables, columns, types, PKs, FKs.
    Returns a structured dict suitable for AI consumption and UI display.
    """
    conn_info = _connections.get(session_id)
    if not conn_info:
        return {"error": "Not connected to any database."}

    engine: Engine = conn_info["engine"]
    insp = inspect(engine)

    tables = {}
    table_names = insp.get_table_names()

    for table_name in table_names:
        columns = []
        for col in insp.get_columns(table_name):
            columns.append({
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": col.get("nullable", True),
                "default": str(col.get("default", "")) if col.get("default") else None,
                "autoincrement": col.get("autoincrement", False),
            })

        pk = insp.get_pk_constraint(table_name)
        fks = insp.get_foreign_keys(table_name)
        indexes = insp.get_indexes(table_name)

        tables[table_name] = {
            "columns": columns,
            "primary_key": pk.get("constrained_columns", []) if pk else [],
            "foreign_keys": [
                {
                    "columns": fk["constrained_columns"],
                    "referred_table": fk["referred_table"],
                    "referred_columns": fk["referred_columns"],
                }
                for fk in fks
            ],
            "indexes": [
                {
                    "name": idx.get("name", ""),
                    "columns": idx.get("column_names", []),
                    "unique": idx.get("unique", False),
                }
                for idx in indexes
            ],
            "row_count": _get_row_count(engine, table_name),
        }

    # Build schema string for AI consumption
    schema_text = _build_schema_text(tables)

    return {
        "tables": tables,
        "table_count": len(tables),
        "schema_text": schema_text,
    }


def _get_row_count(engine: Engine, table_name: str) -> int:
    """Get approximate row count for a table."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))
            return result.scalar() or 0
    except Exception:
        return -1


def _build_schema_text(tables: dict) -> str:
    """Build a human-readable, beautifully indented schema string for AI prompts and UI display."""
    lines = []
    for table_name, info in tables.items():
        cols_formatted = []
        pk_cols = info.get("primary_key", [])
        for c in info["columns"]:
            pk_mark = " PRIMARY KEY" if c["name"] in pk_cols else ""
            cols_formatted.append(f"  {c['name']} {c['type']}{pk_mark}")

        cols_block = ",\n".join(cols_formatted)
        table_str = f"{table_name} (\n{cols_block}\n);"
        lines.append(table_str)

        for fk in info.get("foreign_keys", []):
            lines.append(
                f"  -- Relationship: {', '.join(fk['columns'])} -> {fk['referred_table']}({', '.join(fk['referred_columns'])})"
            )
        lines.append("")
    return "\n".join(lines).strip()


# ──────────────────────────────────────────────────────────────────────────────
# Feature 16: Table & Column Explorer
# ──────────────────────────────────────────────────────────────────────────────
def get_tables(session_id: str) -> list:
    """List all tables in the connected database."""
    conn_info = _connections.get(session_id)
    if not conn_info:
        return []
    insp = inspect(conn_info["engine"])
    return insp.get_table_names()


def get_table_details(session_id: str, table_name: str) -> dict:
    """Get detailed info about a specific table including sample data."""
    conn_info = _connections.get(session_id)
    if not conn_info:
        return {"error": "Not connected to any database."}

    engine: Engine = conn_info["engine"]
    insp = inspect(engine)

    try:
        columns = insp.get_columns(table_name)
        pk = insp.get_pk_constraint(table_name)
        fks = insp.get_foreign_keys(table_name)
        indexes = insp.get_indexes(table_name)

        # Get sample rows
        sample_rows = []
        col_names = [c["name"] for c in columns]
        try:
            with engine.connect() as conn:
                result = conn.execute(text(f'SELECT * FROM "{table_name}" LIMIT 5'))
                for row in result:
                    sample_rows.append(dict(zip(col_names, [_serialize(v) for v in row])))
        except Exception:
            pass

        row_count = _get_row_count(engine, table_name)

        return {
            "name": table_name,
            "columns": [
                {
                    "name": c["name"],
                    "type": str(c["type"]),
                    "nullable": c.get("nullable", True),
                    "default": str(c.get("default", "")) if c.get("default") else None,
                }
                for c in columns
            ],
            "primary_key": pk.get("constrained_columns", []) if pk else [],
            "foreign_keys": [
                {
                    "columns": fk["constrained_columns"],
                    "referred_table": fk["referred_table"],
                    "referred_columns": fk["referred_columns"],
                }
                for fk in fks
            ],
            "indexes": [
                {
                    "name": idx.get("name", ""),
                    "columns": idx.get("column_names", []),
                    "unique": idx.get("unique", False),
                }
                for idx in indexes
            ],
            "row_count": row_count,
            "sample_data": sample_rows,
        }
    except Exception as e:
        return {"error": str(e)}


# ──────────────────────────────────────────────────────────────────────────────
# Feature 17: Foreign-Key / Relationship Detection
# ──────────────────────────────────────────────────────────────────────────────
def get_relationships(session_id: str) -> list:
    """Get all foreign-key relationships across the database."""
    conn_info = _connections.get(session_id)
    if not conn_info:
        return []

    engine: Engine = conn_info["engine"]
    insp = inspect(engine)
    relationships = []

    for table_name in insp.get_table_names():
        fks = insp.get_foreign_keys(table_name)
        for fk in fks:
            relationships.append({
                "from_table": table_name,
                "from_columns": fk["constrained_columns"],
                "to_table": fk["referred_table"],
                "to_columns": fk["referred_columns"],
                "name": fk.get("name", ""),
            })

    return relationships


# ──────────────────────────────────────────────────────────────────────────────
# Feature 18: Database ER Diagram
# ──────────────────────────────────────────────────────────────────────────────
def get_er_diagram_data(session_id: str) -> dict:
    """
    Generate ER diagram data — tables with their columns and relationships.
    Returns data suitable for client-side rendering.
    """
    conn_info = _connections.get(session_id)
    if not conn_info:
        return {"error": "Not connected to any database."}

    engine: Engine = conn_info["engine"]
    insp = inspect(engine)

    nodes = []
    edges = []
    table_names = insp.get_table_names()

    for i, table_name in enumerate(table_names):
        columns = insp.get_columns(table_name)
        pk = insp.get_pk_constraint(table_name)
        pk_cols = pk.get("constrained_columns", []) if pk else []

        node_columns = []
        for col in columns:
            node_columns.append({
                "name": col["name"],
                "type": str(col["type"]),
                "is_pk": col["name"] in pk_cols,
                "nullable": col.get("nullable", True),
            })

        # Layout: arrange in a grid
        cols_in_grid = max(1, int(math.ceil(math.sqrt(len(table_names)))))
        nodes.append({
            "id": table_name,
            "label": table_name,
            "columns": node_columns,
            "x": (i % cols_in_grid) * 300 + 50,
            "y": (i // cols_in_grid) * 250 + 50,
        })

        # Edges from foreign keys
        fks = insp.get_foreign_keys(table_name)
        for fk in fks:
            edges.append({
                "from": table_name,
                "from_col": ", ".join(fk["constrained_columns"]),
                "to": fk["referred_table"],
                "to_col": ", ".join(fk["referred_columns"]),
                "label": fk.get("name", ""),
            })

    return {"nodes": nodes, "edges": edges}


# ──────────────────────────────────────────────────────────────────────────────
# Feature 19 & 20: Live Query Execution & Query Result Preview
# ──────────────────────────────────────────────────────────────────────────────
def execute_query(
    session_id: str,
    sql: str,
    page: int = 1,
    page_size: int = 50,
    sort_column: str = "",
    sort_direction: str = "asc",
    filters: dict | None = None,
) -> dict:
    """
    Execute a SQL query and return paginated results.
    Supports sorting and filtering for Features 28-30.
    """
    conn_info = _connections.get(session_id)
    if not conn_info:
        return {"error": "Not connected to any database."}

    engine: Engine = conn_info["engine"]

    try:
        with engine.connect() as conn:
            # Execute the base query
            result = conn.execute(text(sql))

            # Get column names
            columns = list(result.keys())

            # Fetch all rows
            all_rows = [dict(zip(columns, [_serialize(v) for v in row])) for row in result]

            # Apply filters (Feature 28)
            if filters:
                all_rows = _apply_filters(all_rows, filters)

            # Apply sorting (Feature 29)
            if sort_column and sort_column in columns:
                reverse = sort_direction.lower() == "desc"
                all_rows.sort(
                    key=lambda r: (r.get(sort_column) is None, r.get(sort_column, "")),
                    reverse=reverse,
                )

            total_rows = len(all_rows)
            total_pages = max(1, math.ceil(total_rows / page_size))
            page = max(1, min(page, total_pages))

            # Paginate (Feature 30)
            start = (page - 1) * page_size
            end = start + page_size
            page_rows = all_rows[start:end]

            # Summary statistics (Feature 27)
            stats = _compute_stats(all_rows, columns)

            return {
                "columns": columns,
                "rows": page_rows,
                "total_rows": total_rows,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "stats": stats,
            }

    except Exception as e:
        return {"error": str(e)}


def _apply_filters(rows: list, filters: dict) -> list:
    """Apply column filters to result rows."""
    filtered = rows
    for col, value in filters.items():
        if value is None or value == "":
            continue
        value_str = str(value).lower()
        filtered = [
            r for r in filtered
            if r.get(col) is not None and value_str in str(r[col]).lower()
        ]
    return filtered


def _compute_stats(rows: list, columns: list) -> dict:
    """Compute summary statistics for numeric columns (Feature 27)."""
    stats = {}
    if not rows:
        return stats

    for col in columns:
        values = [r[col] for r in rows if r.get(col) is not None]
        if not values:
            continue

        # Try numeric stats
        numeric = []
        for v in values:
            try:
                numeric.append(float(v))
            except (ValueError, TypeError):
                pass

        if len(numeric) > len(values) * 0.5:  # Mostly numeric
            numeric.sort()
            stats[col] = {
                "type": "numeric",
                "count": len(numeric),
                "min": min(numeric),
                "max": max(numeric),
                "avg": round(sum(numeric) / len(numeric), 2),
                "sum": round(sum(numeric), 2),
                "null_count": len(values) - len(numeric),
            }
        else:
            # Categorical stats
            unique = set(str(v) for v in values)
            stats[col] = {
                "type": "categorical",
                "count": len(values),
                "unique": len(unique),
                "null_count": len(rows) - len(values),
                "top_values": _top_values(values, 5),
            }

    return stats


def _top_values(values: list, n: int = 5) -> list:
    """Get top N most frequent values."""
    from collections import Counter
    counts = Counter(str(v) for v in values)
    return [{"value": val, "count": cnt} for val, cnt in counts.most_common(n)]


def _serialize(value: Any) -> Any:
    """Serialize a database value to JSON-compatible type."""
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, bytes):
        return value.hex()
    # datetime, date, etc
    try:
        return str(value)
    except Exception:
        return repr(value)


def init_sample_db(session_id: str) -> dict:
    """Initialize a rich SQLite sample database and connect the session to it."""
    db_path = os.path.join(os.getcwd(), "sample_store.db")
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON;"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS categories (
                category_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                department TEXT NOT NULL
            );
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS customers (
                customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                country TEXT NOT NULL,
                city TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS products (
                product_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category_id INTEGER,
                price REAL NOT NULL,
                stock_quantity INTEGER NOT NULL,
                FOREIGN KEY (category_id) REFERENCES categories(category_id)
            );
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER,
                order_date TEXT NOT NULL,
                total_amount REAL NOT NULL,
                status TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
            );
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS order_items (
                item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER,
                product_id INTEGER,
                quantity INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(order_id),
                FOREIGN KEY (product_id) REFERENCES products(product_id)
            );
        """))

        cat_count = conn.execute(text("SELECT COUNT(*) FROM categories")).scalar()
        if cat_count == 0:
            conn.execute(text("""
                INSERT INTO categories (name, department) VALUES
                ('Laptops & PCs', 'Electronics'),
                ('Smartphones', 'Electronics'),
                ('Audio & Headphones', 'Electronics'),
                ('Office Chairs', 'Furniture'),
                ('Smart Lighting', 'Home Automation');
            """))
            conn.execute(text("""
                INSERT INTO customers (name, email, country, city, created_at) VALUES
                ('Alice Walker', 'alice@techcorp.com', 'United States', 'San Francisco', '2024-01-15'),
                ('Bob Chen', 'bob.chen@quantum.io', 'Canada', 'Toronto', '2024-02-01'),
                ('Carlos Diaz', 'carlos@madrid.es', 'Spain', 'Madrid', '2024-02-12'),
                ('Diana Prince', 'diana@amazon.net', 'United States', 'Seattle', '2024-03-05'),
                ('Ethan Hunt', 'ethan@imf.gov', 'United Kingdom', 'London', '2024-03-20'),
                ('Fiona Gallagher', 'fiona@southside.org', 'United States', 'Chicago', '2024-04-02'),
                ('George Miller', 'george@sydney.au', 'Australia', 'Sydney', '2024-04-14'),
                ('Hanna Becker', 'hanna@berlin.de', 'Germany', 'Berlin', '2024-05-01');
            """))
            conn.execute(text("""
                INSERT INTO products (name, category_id, price, stock_quantity) VALUES
                ('ProBook X15 Laptop', 1, 1299.99, 45),
                ('UltraMini PC', 1, 649.50, 20),
                ('Apex Phone Pro', 2, 999.00, 80),
                ('Nova Phone 5G', 2, 499.00, 110),
                ('AcousticMax Headphones', 3, 199.99, 150),
                ('BassBlast Earbuds', 3, 79.99, 200),
                ('ErgoLux Executive Chair', 4, 349.00, 35),
                ('MeshComfort Task Chair', 4, 189.00, 60),
                ('Ambient Glow Smart Lamp', 5, 59.99, 90),
                ('Smart RGB Light Strip', 5, 34.50, 140);
            """))
            conn.execute(text("""
                INSERT INTO orders (customer_id, order_date, total_amount, status) VALUES
                (1, '2024-06-01', 1499.98, 'completed'),
                (2, '2024-06-05', 999.00, 'completed'),
                (3, '2024-06-10', 548.99, 'completed'),
                (4, '2024-06-15', 1848.98, 'completed'),
                (5, '2024-06-20', 279.98, 'pending'),
                (6, '2024-07-01', 729.49, 'completed'),
                (7, '2024-07-04', 1299.99, 'shipped'),
                (8, '2024-07-10', 443.49, 'completed'),
                (1, '2024-07-15', 383.50, 'completed'),
                (3, '2024-07-22', 999.00, 'shipped');
            """))
            conn.execute(text("""
                INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
                (1, 1, 1, 1299.99),
                (1, 5, 1, 199.99),
                (2, 3, 1, 999.00),
                (3, 7, 1, 349.00),
                (3, 5, 1, 199.99),
                (4, 1, 1, 1299.99),
                (4, 7, 1, 349.00),
                (4, 6, 2, 79.99),
                (5, 5, 1, 199.99),
                (5, 6, 1, 79.99),
                (6, 2, 1, 649.50),
                (6, 6, 1, 79.99),
                (7, 1, 1, 1299.99),
                (8, 7, 1, 349.00),
                (8, 10, 1, 34.50),
                (8, 9, 1, 59.99),
                (9, 7, 1, 349.00),
                (9, 10, 1, 34.50),
                (10, 3, 1, 999.00);
            """))

    _connections[session_id] = {
        "engine": engine,
        "db_type": "sqlite",
        "db_name": "sample_store.db",
    }
    return {
        "status": "connected",
        "db_type": "sqlite",
        "database": "sample_store.db",
        "message": "Successfully connected to Sample Store database (SQLite).",
    }


def init_customer_behavior_db(session_id: str) -> dict:
    """Connect to the bundled customer_behavior SQLite database (3,900 rows)."""
    db_path = os.path.join(os.getcwd(), "customer_behavior.db")
    if not os.path.exists(db_path):
        return {"status": "error", "message": "customer_behavior.db was not found on the server."}

    engine = create_engine(f"sqlite:///{db_path}")
    _connections[session_id] = {
        "engine": engine,
        "db_type": "sqlite",
        "db_name": "customer_behavior",
    }
    return {
        "status": "connected",
        "db_type": "sqlite",
        "database": "customer_behavior",
        "message": "Successfully connected to Customer Behavior database (3,900 records)!",
    }



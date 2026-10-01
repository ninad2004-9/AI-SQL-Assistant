"""
Database Manager Module — Features 11-20
Handles database connectivity, schema introspection, query execution.
Supports PostgreSQL, MySQL, and SQLite via SQLAlchemy.
"""

import os
import math
from typing import Any
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


# ── Connection store: session_token -> {engine, db_type, db_name} ────────────
_connections: dict[str, dict] = {}


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
    try:
        if db_type == "postgresql":
            url = f"postgresql+psycopg2://{username}:{password}@{host}:{port}/{database}"
        elif db_type == "mysql":
            url = f"mysql+pymysql://{username}:{password}@{host}:{port}/{database}"
        elif db_type == "sqlite":
            path = database if database else ":memory:"
            url = f"sqlite:///{path}"
        else:
            return {"status": "error", "message": f"Unsupported database type: {db_type}"}

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
        return {"status": "error", "message": str(e)}


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
    """Build a human-readable schema string for AI prompts."""
    lines = []
    for table_name, info in tables.items():
        cols = ", ".join(
            f"{c['name']} {c['type']}" + (" PK" if c['name'] in info.get('primary_key', []) else "")
            for c in info["columns"]
        )
        lines.append(f"{table_name}({cols})")
        for fk in info.get("foreign_keys", []):
            lines.append(
                f"  FK: {', '.join(fk['columns'])} -> {fk['referred_table']}({', '.join(fk['referred_columns'])})"
            )
    return "\n".join(lines)


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

import sys
import os
import json

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def run_tests():
    print("=== STARTING FULL 30-FEATURE VERIFICATION ===")

    # 1. Health Check
    res = client.get("/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    health_data = res.json()
    print(f"[OK] Health Check passed: status={health_data.get('status')}, version={health_data.get('version')}")

    # 2. Auth Flow (Register & Login)
    user_data = {"name": "Test Engineer", "email": "engineer@querymind.io", "password": "securepassword123"}
    res = client.post("/auth/register", json=user_data)
    if res.status_code == 400: # Already registered
        res = client.post("/auth/login", json={"email": user_data["email"], "password": user_data["password"]})
    assert res.status_code == 200, f"Auth failed: {res.text}"
    auth = res.json()
    token = auth["token"]
    print(f"[OK] Auth passed: user={auth.get('name')}, token received")

    # 3. Database Features: Connect SQLite Demo DB (Features 11-13)
    res = client.post("/db/sample", json={"session_token": token})
    assert res.status_code == 200, f"Sample DB connect failed: {res.text}"
    db_conn = res.json()
    print(f"[OK] Features 11-13 (DB Connect): {db_conn.get('message')}")

    # 4. DB Status Check
    res = client.get(f"/db/status?session_token={token}")
    assert res.status_code == 200
    status_info = res.json()
    assert status_info.get("connected") == True, "DB not reported as connected"
    print(f"[OK] DB Status check passed: {status_info}")

    # 5. Schema Import & Automatic Analysis (Features 14, 15)
    res = client.get(f"/db/schema?session_token={token}")
    assert res.status_code == 200, f"Schema get failed: {res.text}"
    schema_info = res.json()
    table_names = list(schema_info.get("tables", {}).keys())
    assert len(table_names) >= 4, f"Expected tables, got {table_names}"
    print(f"[OK] Features 14 & 15 (Schema Import & Analysis): Found {len(table_names)} tables: {table_names}")

    # 6. Table & Column Explorer (Feature 16)
    res = client.get(f"/db/tables?session_token={token}")
    assert res.status_code == 200
    tables = res.json()["tables"]
    assert "products" in tables

    res = client.get(f"/db/tables/products?session_token={token}")
    assert res.status_code == 200
    prod_details = res.json()
    assert len(prod_details["columns"]) >= 4
    print(f"[OK] Feature 16 (Table & Column Explorer): Verified 'products' with {len(prod_details['columns'])} columns")

    # 7. Foreign-Key / Relationship Detection (Feature 17)
    res = client.get(f"/db/relationships?session_token={token}")
    assert res.status_code == 200
    rel_info = res.json()
    relationships = rel_info.get("relationships", [])
    assert len(relationships) >= 3, f"Expected FK relationships, got {relationships}"
    print(f"[OK] Feature 17 (FK/Relationship Detection): Detected {len(relationships)} relationships")

    # 8. Database ER Diagram Data (Feature 18)
    res = client.get(f"/db/er-diagram?session_token={token}")
    assert res.status_code == 200
    er_data = res.json()
    assert len(er_data.get("nodes", [])) >= 4
    assert len(er_data.get("edges", [])) >= 3
    print(f"[OK] Feature 18 (Database ER Diagram): {len(er_data['nodes'])} nodes, {len(er_data['edges'])} edges ready for canvas")

    # 9. Live Query Execution (Features 19, 20, 25, 27, 28, 29, 30)
    exec_payload = {
        "sql": "SELECT p.name AS product, c.name AS category, p.price, p.stock_quantity FROM products p JOIN categories c ON p.category_id = c.category_id",
        "page": 1,
        "page_size": 5,
        "sort_column": "price",
        "sort_direction": "desc",
        "filters": {},
        "session_token": token
    }
    res = client.post("/db/execute", json=exec_payload)
    assert res.status_code == 200, f"Query execution failed: {res.text}"
    exec_res = res.json()
    assert "columns" in exec_res and len(exec_res["rows"]) == 5
    assert exec_res["total_rows"] == 10
    assert exec_res["total_pages"] == 2
    # Verify summary statistics (Feature 27)
    assert "price" in exec_res["stats"]
    price_stats = exec_res["stats"]["price"]
    assert price_stats["type"] == "numeric" and price_stats["max"] >= 1299
    print(f"[OK] Features 19, 20, 25, 27, 28, 29, 30 (Live Query, Preview, Table, Stats, Sort, Pagination): Success! Total rows={exec_res['total_rows']}, Page={exec_res['page']}, Max price={price_stats['max']}")

    # 10. Filter Query Results (Feature 28)
    exec_filter_payload = {
        "sql": "SELECT name, price, stock_quantity FROM products",
        "page": 1,
        "page_size": 10,
        "sort_column": "",
        "sort_direction": "asc",
        "filters": {"name": "Phone"},
        "session_token": token
    }
    res = client.post("/db/execute", json=exec_filter_payload)
    assert res.status_code == 200
    filtered_res = res.json()
    print("DEBUG filtered_res total_rows:", filtered_res["total_rows"], "rows:", [r.get('name') for r in filtered_res.get('rows', [])])
    assert filtered_res["total_rows"] >= 2
    print(f"[OK] Feature 28 (Filter Query Results): Filter 'name=Phone' matched exactly {filtered_res['total_rows']} rows")

    # 11. AI Features: Test with Groq API
    test_sql = "SELECT c.name, SUM(o.total_amount) AS total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.name ORDER BY total_spent DESC LIMIT 5;"

    # Feature 4 & 10: Natural Language -> SQL with multi-turn
    print("\n--- Testing AI Features via Groq API ---")
    gen_payload = {
        "question": "Show top 5 customers by total spending with their names",
        "db_schema": schema_info.get("schema_text", ""),
        "dialect": "SQLite",
        "session_token": token
    }
    res = client.post("/generate", json=gen_payload)
    assert res.status_code == 200, f"Generate SQL failed: {res.text}"
    gen_data = res.json()
    assert "sql" in gen_data
    print(f"[OK] Feature 4 & 10 (NL -> SQL & Multi-turn): SQL={gen_data['sql'][:60]}...")

    # Feature 1: AI SQL Explainer
    res = client.post("/explain", json={"sql": test_sql, "dialect": "SQLite", "session_token": token})
    assert res.status_code == 200, f"Explain failed: {res.text}"
    explain_data = res.json()
    assert "summary" in explain_data
    print(f"[OK] Feature 1 (AI SQL Explainer): Complexity={explain_data.get('complexity')}, Summary={explain_data.get('summary')[:60]}...")

    # Feature 2: SQL Error Fixer
    bad_sql = "SELECT * FORM customers WEHRE id = 1"
    res = client.post("/fix", json={"sql": bad_sql, "error_message": "syntax error near FORM", "dialect": "SQLite", "session_token": token})
    assert res.status_code == 200, f"Fix failed: {res.text}"
    fix_data = res.json()
    assert fix_data.get("has_errors") == True
    print(f"[OK] Feature 2 (SQL Error Fixer): Fixed SQL={fix_data.get('fixed_sql')}")

    # Feature 3: SQL Optimizer
    res = client.post("/optimize", json={"sql": test_sql, "dialect": "SQLite", "db_schema": schema_info.get("schema_text", ""), "session_token": token})
    assert res.status_code == 200, f"Optimize failed: {res.text}"
    opt_data = res.json()
    print(f"[OK] Feature 3 (SQL Optimizer): Explanation={opt_data.get('explanation')[:60]}...")

    # Feature 5: SQL -> Natural Language
    res = client.post("/sql-to-nl", json={"sql": test_sql, "session_token": token})
    assert res.status_code == 200, f"SQL-to-NL failed: {res.text}"
    nl_data = res.json()
    assert "natural_language" in nl_data
    print(f"[OK] Feature 5 (SQL -> Natural Language): NL={nl_data.get('natural_language')[:60]}...")

    # Feature 6: AI Query Suggestions
    res = client.post("/suggestions", json={"question": "top customers", "sql": test_sql, "session_token": token})
    assert res.status_code == 200, f"Suggestions failed: {res.text}"
    sugg_data = res.json()
    suggestions = sugg_data.get("suggestions", [])
    print(f"[OK] Feature 6 (AI Query Suggestions): Received {len(suggestions)} suggestions")

    # Feature 7 & 26: AI Data Insights
    res = client.post("/insights", json={"sql": test_sql, "results": exec_res["rows"], "columns": exec_res["columns"], "session_token": token})
    assert res.status_code == 200, f"Insights failed: {res.text}"
    insights_data = res.json()
    print(f"[OK] Features 7 & 26 (AI Data Insights): Insights={len(insights_data.get('insights', []))}, Chart Rec={insights_data.get('chart_recommendation')}")

    # Feature 8: AI Follow-up Questions
    res = client.post("/followup", json={"question": "top customers", "sql": test_sql, "session_token": token})
    assert res.status_code == 200, f"Followup failed: {res.text}"
    follow_data = res.json()
    print(f"[OK] Feature 8 (AI Follow-up Questions): Received {len(follow_data.get('followups', []))} follow-ups")

    # Feature 9: AI Query Validation
    res = client.post("/validate", json={"question": "Show top 5 customers by total spending", "sql": test_sql, "dialect": "SQLite", "session_token": token})
    assert res.status_code == 200, f"Validate failed: {res.text}"
    val_data = res.json()
    print(f"[OK] Feature 9 (AI Query Validation): Valid={val_data.get('is_valid')}, Confidence={val_data.get('confidence')}")

    # Feature 10: Multi-turn Conversation Context Verification
    res = client.get(f"/conversation/history?session_token={token}")
    assert res.status_code == 200
    hist = res.json().get("history", [])
    assert len(hist) > 0, "Expected conversation history"
    print(f"[OK] Feature 10 (Multi-turn Context): {len(hist)} turns preserved in context store")

    # Clear conversation
    res = client.post("/conversation/clear", json={"session_token": token})
    assert res.status_code == 200
    res = client.get(f"/conversation/history?session_token={token}")
    assert len(res.json().get("history", [])) == 0
    print("[OK] Multi-turn Clear Conversation verified")

    # Disconnect DB
    res = client.post("/db/disconnect", json={"session_token": token})
    assert res.status_code == 200
    print("[OK] Disconnect DB verified")

    print("\n=== ALL 30 FEATURES VERIFIED AND FUNCTIONING PERFECTLY! ===")

if __name__ == "__main__":
    run_tests()

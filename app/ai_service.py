"""
AI Service Module — Features 1-10
Handles all AI/LLM operations via Groq API.
"""

import json
import os
from groq import Groq

MODELS_TO_TRY = [
    os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
]
_client = None


def _get_client() -> Groq:
    global _client
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY environment variable is missing. Please set it in your .env file.")
    if _client is None:
        _client = Groq(api_key=api_key)
    return _client


# ── Multi-turn conversation store (Feature 10) ──────────────────────────────────
# session_token -> list of {role, content}
conversations: dict[str, list[dict]] = {}
MAX_CONTEXT_MESSAGES = 20


def _execute_chat(messages: list, temperature: float = 0.3, max_tokens: int = 2048) -> str:
    """Execute chat completion with fallback across available Groq models."""
    client = _get_client()
    last_err = None
    for model_name in MODELS_TO_TRY:
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            content = response.choices[0].message.content
            if content and content.strip():
                return content.strip()
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    raise RuntimeError("No LLM model returned a response.")


def _call_llm(system_prompt: str, user_message: str, temperature: float = 0.3) -> str:
    """Call Groq LLM and return raw text."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    return _execute_chat(messages, temperature=temperature)


def _call_llm_with_context(
    system_prompt: str,
    user_message: str,
    session_token: str = "",
    temperature: float = 0.3,
) -> str:
    """Call Groq LLM with multi-turn conversation context."""
    messages = [{"role": "system", "content": system_prompt}]

    # Append conversation history for context
    if session_token and session_token in conversations:
        history = conversations[session_token][-MAX_CONTEXT_MESSAGES:]
        messages.extend(history)

    messages.append({"role": "user", "content": user_message})
    return _execute_chat(messages, temperature=temperature)


def _parse_json(raw: str) -> dict:
    """Extract and parse JSON from LLM response, handling markdown fences and extra prose."""
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Extract the outermost JSON object if surrounding prose was returned
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end+1])
        raise


def _safe_json_call(system_prompt: str, user_message: str, temperature: float = 0.3) -> dict:
    """Call LLM expecting JSON response with error handling."""
    raw = _call_llm(system_prompt, user_message, temperature)
    try:
        return _parse_json(raw)
    except (json.JSONDecodeError, IndexError):
        return {"error": f"Failed to parse AI response", "raw": raw}


# ──────────────────────────────────────────────────────────────────────────────
# Feature 1: AI SQL Explainer
# ──────────────────────────────────────────────────────────────────────────────
def explain_sql(sql: str, dialect: str = "PostgreSQL") -> dict:
    """Explain a SQL query in simple language."""
    system_prompt = f"""You are a SQL expert. Explain the given {dialect} SQL query in simple, easy-to-understand language.

Respond ONLY with a JSON object (no markdown, no backticks) in this exact format:
{{
  "summary": "A one-sentence summary of what the query does",
  "breakdown": [
    {{"clause": "SELECT ...", "explanation": "What this part does"}},
    {{"clause": "FROM ...", "explanation": "What this part does"}}
  ],
  "complexity": "simple|moderate|complex",
  "tips": ["Optional tip 1", "Optional tip 2"]
}}"""
    return _safe_json_call(system_prompt, f"Explain this SQL:\n{sql}")


# ──────────────────────────────────────────────────────────────────────────────
# Feature 2: SQL Error Fixer
# ──────────────────────────────────────────────────────────────────────────────
def fix_sql(sql: str, error_message: str = "", dialect: str = "PostgreSQL") -> dict:
    """Detect errors in SQL and provide corrected version."""
    system_prompt = f"""You are a SQL debugging expert for {dialect}. Analyze the SQL query for errors — syntax errors, logical issues, missing clauses, wrong function usage, etc.

{f"The user received this error: {error_message}" if error_message else "Find any errors or potential issues in the query."}

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "has_errors": true,
  "errors": [
    {{"type": "syntax|logic|missing|performance", "description": "What's wrong", "location": "Which part"}}
  ],
  "fixed_sql": "The corrected SQL query",
  "changes": ["Description of change 1", "Description of change 2"],
  "explanation": "Brief summary of all fixes"
}}

If the query has no errors, set has_errors to false, errors to [], fixed_sql to the original query, and changes to []."""
    return _safe_json_call(system_prompt, f"Analyze and fix this SQL:\n{sql}")


# ──────────────────────────────────────────────────────────────────────────────
# Feature 3: SQL Optimizer
# ──────────────────────────────────────────────────────────────────────────────
def optimize_sql(sql: str, dialect: str = "PostgreSQL", schema: str = "") -> dict:
    """Suggest optimized version of the query and indexing improvements."""
    schema_ctx = f"\nDatabase schema:\n{schema}" if schema else ""
    system_prompt = f"""You are a {dialect} performance optimization expert.{schema_ctx}

Analyze the query and suggest optimizations including:
- Query rewriting for better performance
- Index recommendations
- Avoiding full table scans
- Better JOIN strategies
- Subquery optimization

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "optimized_sql": "The optimized SQL query",
  "improvements": [
    {{"type": "index|rewrite|join|subquery|other", "description": "What was improved", "impact": "high|medium|low"}}
  ],
  "index_suggestions": [
    {{"table": "table_name", "columns": ["col1", "col2"], "reason": "Why this index helps"}}
  ],
  "estimated_improvement": "Brief description of expected performance gain",
  "explanation": "Overall optimization summary"
}}"""
    return _safe_json_call(system_prompt, f"Optimize this SQL:\n{sql}")


# ──────────────────────────────────────────────────────────────────────────────
# Feature 4: Natural Language → SQL (Enhanced with multi-turn)
# ──────────────────────────────────────────────────────────────────────────────
def generate_sql(
    question: str,
    schema: str = "",
    dialect: str = "PostgreSQL",
    session_token: str = "",
) -> dict:
    """Generate SQL from natural language question with multi-turn context."""
    schema_ctx = f"The database schema is:\n{schema}" if schema else "Infer reasonable table and column names from the question."

    system_prompt = f"""You are an expert SQL query generator. Convert plain English into valid {dialect} SQL.
{schema_ctx}

If the user refers to previous queries or results, use the conversation context to understand what they mean.

Respond ONLY with a JSON object (no markdown, no backticks):
{{"sql": "the SQL query", "explanation": "brief one-sentence explanation of what the query does"}}"""

    raw = _call_llm_with_context(system_prompt, question, session_token)

    # Save to conversation history
    add_to_conversation(session_token, "user", question)

    try:
        parsed = _parse_json(raw)
        add_to_conversation(
            session_token,
            "assistant",
            f"Generated SQL: {parsed.get('sql', '')} — {parsed.get('explanation', '')}",
        )
        return parsed
    except (json.JSONDecodeError, IndexError):
        return {"error": f"Failed to parse response", "raw": raw}


# ──────────────────────────────────────────────────────────────────────────────
# Feature 5: SQL → Natural Language
# ──────────────────────────────────────────────────────────────────────────────
def sql_to_natural_language(sql: str) -> dict:
    """Convert SQL query into a human-readable explanation."""
    system_prompt = """You are a SQL expert. Convert the given SQL query into a clear, human-readable natural language description that anyone can understand — even non-technical people.

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "natural_language": "A clear description of what this query does in plain English",
  "audience_friendly": "An even simpler version for non-technical stakeholders"
}"""
    return _safe_json_call(system_prompt, f"Convert to natural language:\n{sql}")


# ──────────────────────────────────────────────────────────────────────────────
# Feature 6: AI Query Suggestions
# ──────────────────────────────────────────────────────────────────────────────
def get_suggestions(question: str, sql: str = "", schema: str = "") -> dict:
    """Suggest related queries based on the current question."""
    schema_ctx = f"\nDatabase schema:\n{schema}" if schema else ""
    system_prompt = f"""You are a SQL assistant. Based on the user's current query, suggest 4-6 related queries they might find useful.{schema_ctx}

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "suggestions": [
    {{"question": "Natural language question", "description": "Why this might be useful", "category": "drill-down|comparison|aggregation|trend|related"}},
    ...
  ]
}}"""
    msg = f"Current question: {question}"
    if sql:
        msg += f"\nGenerated SQL: {sql}"
    return _safe_json_call(system_prompt, msg, temperature=0.5)


# ──────────────────────────────────────────────────────────────────────────────
# Feature 7: AI Data Insights
# ──────────────────────────────────────────────────────────────────────────────
def get_data_insights(sql: str, results: list, columns: list) -> dict:
    """Analyze query results and provide useful insights."""
    # Limit results to first 50 rows for token efficiency
    sample = results[:50]
    system_prompt = """You are a data analyst. Analyze the query results and provide useful insights, patterns, anomalies, and observations.

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "insights": [
    {"type": "pattern|anomaly|trend|observation|recommendation", "title": "Short title", "description": "Detailed insight"}
  ],
  "summary": "A brief overall summary of the data",
  "chart_recommendation": {
    "type": "bar|line|pie|table",
    "x_column": "suggested x-axis column",
    "y_column": "suggested y-axis column",
    "reason": "Why this chart type fits the data"
  }
}"""
    msg = f"SQL: {sql}\nColumns: {json.dumps(columns)}\nResults (sample):\n{json.dumps(sample, default=str)}"
    return _safe_json_call(system_prompt, msg, temperature=0.4)


# ──────────────────────────────────────────────────────────────────────────────
# Feature 8: AI Follow-up Questions
# ──────────────────────────────────────────────────────────────────────────────
def get_followup_questions(question: str, sql: str = "", schema: str = "") -> dict:
    """Generate follow-up questions based on previous query context."""
    schema_ctx = f"\nDatabase schema:\n{schema}" if schema else ""
    system_prompt = f"""You are a SQL assistant. Based on the user's query and the generated SQL, suggest 3-5 natural follow-up questions they might want to ask next.{schema_ctx}

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "followups": [
    {{"question": "The follow-up question in natural language", "intent": "What this question would explore"}}
  ]
}}"""
    msg = f"User asked: {question}"
    if sql:
        msg += f"\nGenerated SQL: {sql}"
    return _safe_json_call(system_prompt, msg, temperature=0.5)


# ──────────────────────────────────────────────────────────────────────────────
# Feature 9: AI Query Validation
# ──────────────────────────────────────────────────────────────────────────────
def validate_query(question: str, sql: str, schema: str = "", dialect: str = "PostgreSQL") -> dict:
    """Check whether generated SQL matches the user's intention."""
    schema_ctx = f"\nDatabase schema:\n{schema}" if schema else ""
    system_prompt = f"""You are a SQL validation expert for {dialect}.{schema_ctx}

Compare the user's natural language question with the generated SQL query. Check whether:
1. The SQL correctly captures the user's intent
2. The SQL would produce the expected results
3. There are any missing conditions or filters
4. The output columns match what was asked for

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "is_valid": true,
  "confidence": 0.95,
  "issues": [
    {{"severity": "critical|warning|info", "description": "What might be wrong"}}
  ],
  "corrected_sql": "If issues found, the corrected SQL. Otherwise, the original SQL.",
  "explanation": "Brief explanation of the validation result"
}}"""
    msg = f"User's question: {question}\nGenerated SQL: {sql}"
    return _safe_json_call(system_prompt, msg)


# ──────────────────────────────────────────────────────────────────────────────
# Feature 10: Multi-turn AI Conversation (context management)
# ──────────────────────────────────────────────────────────────────────────────
def add_to_conversation(session_token: str, role: str, content: str) -> None:
    """Add a message to the conversation history."""
    if not session_token:
        return
    if session_token not in conversations:
        conversations[session_token] = []
    conversations[session_token].append({"role": role, "content": content})
    # Trim to prevent unbounded growth
    if len(conversations[session_token]) > MAX_CONTEXT_MESSAGES * 2:
        conversations[session_token] = conversations[session_token][-MAX_CONTEXT_MESSAGES:]


def get_conversation_context(session_token: str) -> list:
    """Return conversation history for a session."""
    return conversations.get(session_token, [])


def clear_conversation(session_token: str) -> None:
    """Clear conversation history for a session."""
    conversations.pop(session_token, None)


# ──────────────────────────────────────────────────────────────────────────────
# Feature: AI Query Performance Analyzer
# ──────────────────────────────────────────────────────────────────────────────
def analyze_query_plan(sql: str, plan_raw: str, dialect: str = "postgresql") -> dict:
    """Analyze a SQL query execution plan and provide actionable recommendations."""
    system_prompt = f"""You are a {dialect} database performance expert. Analyze the provided SQL query and its EXPLAIN plan output.

Identify:
1. Expensive operations (Seq Scans on large tables, Hash Joins, Nested Loops with many rows)
2. Missing indexes that would significantly improve performance
3. Query structure issues that cause poor execution
4. Estimated vs actual row count discrepancies (if available)

Respond ONLY with a JSON object (no markdown, no backticks):
{{
  "overall_score": "good|fair|poor",
  "summary": "One sentence performance summary",
  "findings": [
    {{
      "severity": "high|medium|low",
      "type": "seq_scan|missing_index|expensive_join|row_estimate|other",
      "title": "Short finding title",
      "description": "Detailed description of the issue",
      "location": "Which part of the query/plan"
    }}
  ],
  "index_recommendations": [
    {{
      "table": "table_name",
      "columns": ["col1", "col2"],
      "type": "btree|hash|gin|gist",
      "sql": "CREATE INDEX idx_name ON table_name (col1, col2);",
      "reason": "Why this index helps"
    }}
  ],
  "rewrite_suggestion": "Optional: a rewritten query if beneficial, or empty string",
  "estimated_improvement": "Description of expected performance gain after applying recommendations"
}}"""

    msg = f"SQL Query:\n{sql}\n\nEXPLAIN Plan Output:\n{plan_raw}"
    return _safe_json_call(system_prompt, msg, temperature=0.2)


def generate_table_documentation(table_name: str, columns: list, sample_data: list, row_count: int) -> dict:
    """Generate human-readable documentation for a database table."""
    col_desc = ", ".join(f"{c['name']} ({c['type']})" for c in columns[:20])
    sample_str = str(sample_data[:3]) if sample_data else "No sample data"

    system_prompt = """You are a technical documentation expert. Generate clear, useful documentation for a database table.

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "purpose": "One sentence describing what this table stores",
  "business_context": "How this table is typically used in a business context",
  "key_columns": [
    {"name": "column_name", "description": "What this column represents"}
  ],
  "typical_queries": [
    "A natural language query someone might run against this table"
  ],
  "relationships": "Brief description of how this table relates to others in the schema"
}"""

    msg = f"Table: {table_name}\nRow count: {row_count}\nColumns: {col_desc}\nSample data: {sample_str}"
    return _safe_json_call(system_prompt, msg, temperature=0.4)

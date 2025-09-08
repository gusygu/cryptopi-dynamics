
#!/usr/bin/env bash
set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
SQL_PATH="${2:-cleanup_all.sql}"

echo "== cleanup_db.sh =="
if [[ ! -f "$SQL_PATH" ]]; then
  echo "SQL file not found: $SQL_PATH" >&2
  exit 1
fi

if [[ -z "${DB_URL}" ]]; then
  echo "DATABASE_URL not provided. Pass as arg #1 or set env DATABASE_URL." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL client (psql) and ensure it's on PATH." >&2
  exit 1
fi

# Mask credentials in echo
masked="${DB_URL%%://*}://****@${DB_URL#*@}"
echo "SQL file: $SQL_PATH"
echo "DATABASE_URL: $masked"

PGOPTIONS="-c client_min_messages=notice" psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_PATH"
echo "Cleanup completed successfully."

#!/usr/bin/env bash
# Base de datos local para desarrollo y CI, sin depender de Docker.
# Uso: bash scripts/db-local.sh [reset|migrate|seed|test|psql]
set -euo pipefail

DB_NAME="${PGDATABASE:-punto_madera}"
PSQL_SUPER="${PSQL_SUPER:-psql}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_super() { $PSQL_SUPER -v ON_ERROR_STOP=1 -q "$@"; }
run_db()    { $PSQL_SUPER -v ON_ERROR_STOP=1 -q -d "$DB_NAME" "$@"; }

migrate() {
  echo "→ Aplicando migraciones sobre '$DB_NAME'"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "   · $(basename "$f")"
    run_db -f "$f"
  done
}

seed() {
  echo "→ Cargando datos semilla"
  run_db -f "$ROOT/supabase/seed.sql"
}

case "${1:-migrate}" in
  reset)
    echo "→ Recreando la base '$DB_NAME'"
    run_super -d postgres -c "drop database if exists $DB_NAME with (force)"
    run_super -d postgres -c "create database $DB_NAME"
    migrate
    seed
    echo "✓ Base lista"
    ;;
  migrate) migrate ;;
  seed)    seed ;;
  test)
    echo "→ Pruebas de base de datos"
    for f in "$ROOT"/supabase/tests/*.sql; do
      echo "   · $(basename "$f")"
      run_db -f "$f"
    done
    # Pruebas que necesitan más de una conexión simultánea.
    for f in "$ROOT"/supabase/tests/*.sh; do
      [ -e "$f" ] || continue
      echo "   · $(basename "$f")"
      PGDATABASE="$DB_NAME" bash "$f"
    done
    echo "✓ Pruebas de base de datos OK"
    ;;
  psql) $PSQL_SUPER -d "$DB_NAME" ;;
  *) echo "Comando desconocido: $1" >&2; exit 1 ;;
esac

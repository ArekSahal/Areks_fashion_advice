#!/usr/bin/env bash
# Checks that every file in supabase/migrations follows <14-digit timestamp>_<snake_name>.sql,
# that timestamps are unique, and that every new table enables Row Level Security.
set -euo pipefail
dir="supabase/migrations"
fail=0
seen=""

for f in "$dir"/*.sql; do
  [ -e "$f" ] || { echo "No migrations yet."; exit 0; }
  name=$(basename "$f")
  if ! [[ "$name" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "Bad migration name: $name (expected YYYYMMDDHHMMSS_snake_case.sql)"; fail=1
  fi
  ts=${name:0:14}
  if grep -qx "$ts" <<<"$seen"; then echo "Duplicate migration timestamp: $ts"; fail=1; fi
  seen+="$ts"$'\n'

  # Every "create table public.x" needs a matching "alter table public.x enable row level security".
  while read -r table; do
    [ -z "$table" ] && continue
    if ! grep -qiE "alter table (if exists )?(public\.)?${table}[[:space:]]+enable row level security" "$dir"/*.sql; then
      echo "$name: table '$table' has no 'enable row level security'"; fail=1
    fi
  done < <(grep -ioE "create table (if not exists )?(public\.)?[a-z0-9_]+" "$f" | awk '{print $NF}' | sed 's/^public\.//')
done

[ "$fail" -eq 0 ] && echo "Migrations OK." || exit 1

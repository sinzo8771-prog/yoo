#!/bin/bash
# Creates one database per Keystone app. Runs once on first container boot.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U postgres <<-EOSQL
  SELECT 'CREATE DATABASE openfront' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openfront')\gexec
  SELECT 'CREATE DATABASE openship' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openship')\gexec
  GRANT ALL PRIVILEGES ON DATABASE openfront TO postgres;
  GRANT ALL PRIVILEGES ON DATABASE openship TO postgres;
EOSQL

echo "databases ready: openfront, openship"

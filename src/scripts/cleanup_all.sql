-- cleanup_all.sql
-- Run with:  psql "$DATABASE_URL" -f cleanup_all.sql

DO $$
DECLARE r record;
BEGIN
  -- strategy_aux
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'strategy_aux'
  LOOP
    EXECUTE format('TRUNCATE TABLE strategy_aux.%I RESTART IDENTITY CASCADE', r.tablename);
  END LOOP;

END $$;

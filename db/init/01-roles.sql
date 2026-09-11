-- Runs once, when the Postgres volume is first created.
--
-- The application must not connect as a superuser: superusers bypass row-level
-- security, and RLS is what keeps one tenant's rows invisible to another. So a
-- plain role owns the database, and every table is created with FORCE ROW
-- LEVEL SECURITY so that even the owner is bound by the policies.
CREATE ROLE dunlin LOGIN PASSWORD 'dunlin' NOSUPERUSER NOCREATEROLE;
CREATE DATABASE dunlin OWNER dunlin;
CREATE DATABASE dunlin_test OWNER dunlin;

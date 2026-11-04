-- Creates the isolated benchmark database and its owner. Safe to re-run: it
-- skips what exists and re-applies the password.
--
-- Run as the RDS master user with:
--   psql -v ON_ERROR_STOP=1 -v user=... -v db=... -v pw=... -f db-setup.sql
--
-- `\gexec` runs each generated statement. CREATE DATABASE has no IF NOT EXISTS
-- and can't run inside a DO block, so existence is checked in the query.

SELECT format('CREATE ROLE %I LOGIN', :'user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec

SELECT format('ALTER ROLE %I PASSWORD %L', :'user', :'pw') \gexec

-- Creating a database owned by another role requires membership in that role.
SELECT format('GRANT %I TO CURRENT_USER', :'user') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec

-- Keeps other roles out of the bench database. The reverse direction (bench
-- role into the master database) stays open, but it owns nothing there.
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db') \gexec

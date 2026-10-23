-- Boplo for flight schools (also created on first use by functions/lib/schools.js)
CREATE TABLE IF NOT EXISTS flight_schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'school', seats INTEGER NOT NULL DEFAULT 25, staff_seats INTEGER NOT NULL DEFAULT 10, customer_id TEXT UNIQUE, subscription_id TEXT, status TEXT NOT NULL DEFAULT 'none', current_period_end INTEGER, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, trial_end INTEGER, trial_used INTEGER NOT NULL DEFAULT 0, student_code TEXT UNIQUE NOT NULL, staff_code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS flight_schools_customer ON flight_schools(customer_id);
CREATE TABLE IF NOT EXISTS flight_school_members (user_id TEXT PRIMARY KEY, school_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', joined_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS flight_school_members_school ON flight_school_members(school_id, role);
CREATE TABLE IF NOT EXISTS flight_school_leads (id TEXT PRIMARY KEY, name TEXT, email TEXT, school TEXT, country TEXT, students TEXT, message TEXT, ip TEXT, created_at INTEGER NOT NULL);

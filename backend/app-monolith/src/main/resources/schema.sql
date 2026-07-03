-- Create chat_groups table if it doesn't exist
CREATE TABLE IF NOT EXISTS chat_groups (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    icon_url TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create chat_group_members table if it doesn't exist
CREATE TABLE IF NOT EXISTS chat_group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    username VARCHAR(255) NOT NULL,
    joined_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_group_member UNIQUE (group_id, username)
);

-- Add group_id column to chat_messages if it doesn't exist
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS group_id BIGINT;

-- Ensure users table has co-funding custom fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_wallpapers VARCHAR(1024) DEFAULT 'grid';
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_sounds VARCHAR(1024) DEFAULT 'minimal';

-- Create workspace co-funding and payment audit tables
CREATE TABLE IF NOT EXISTS workspace_upgrade_sessions (
    id VARCHAR(255) PRIMARY KEY,
    workspace_name VARCHAR(255) NOT NULL,
    target_pledges INT NOT NULL,
    pledges_count INT NOT NULL,
    status VARCHAR(255) NOT NULL,
    expiry_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_pledges (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    payment_id VARCHAR(255),
    pre_auth_amount DECIMAL(19, 2) NOT NULL,
    final_captured_amount DECIMAL(19, 2),
    payment_method VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transaction_audits (
    id VARCHAR(255) PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    payment_id VARCHAR(255),
    payment_method VARCHAR(255),
    amount DECIMAL(19, 2) NOT NULL,
    status VARCHAR(255) NOT NULL,
    gateway_ref VARCHAR(255),
    signature VARCHAR(1024),
    timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Feature: Task Labels (v3 migration)
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labels VARCHAR(512);

-- ============================================================
-- Feature: Recurring tasks & Sprint management (v2 migration)
-- ============================================================

-- Add recurring_type column to tasks if it doesn't exist
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_type VARCHAR(50);

-- Create task_comments table
CREATE TABLE IF NOT EXISTS task_comments (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    author VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create task_activities table
CREATE TABLE IF NOT EXISTS task_activities (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    actor VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    detail TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create sprints table
CREATE TABLE IF NOT EXISTS sprints (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    goal TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'PLANNING',
    created_by VARCHAR(255),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create sprint_task_ids join table
CREATE TABLE IF NOT EXISTS sprint_task_ids (
    sprint_id BIGINT NOT NULL,
    task_id BIGINT NOT NULL
);

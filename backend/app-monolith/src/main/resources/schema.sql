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
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_wallpapers VARCHAR(1024) DEFAULT 'grid,wallpaper_neon';
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

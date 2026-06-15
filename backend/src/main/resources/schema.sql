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
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='chat_messages' AND column_name='group_id'
    ) THEN
        ALTER TABLE chat_messages ADD COLUMN group_id BIGINT;
    END IF;
END $$;

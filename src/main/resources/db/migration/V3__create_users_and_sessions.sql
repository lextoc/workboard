CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,

    CONSTRAINT app_user_email_unique UNIQUE (email),
    CONSTRAINT app_user_email_normalized
        CHECK (email = lower(trim(email)) AND email <> '')
);

CREATE TABLE user_session (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    CONSTRAINT user_session_user_fkey
        FOREIGN KEY (user_id) REFERENCES app_user (id),
    CONSTRAINT user_session_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX user_session_user_idx
    ON user_session (user_id);

CREATE INDEX user_session_expiry_idx
    ON user_session (expires_at);

ALTER TABLE ticket
    ADD COLUMN owner_id UUID
        REFERENCES app_user (id);

ALTER TABLE project
    ADD COLUMN owner_id UUID
        REFERENCES app_user (id);

CREATE INDEX ticket_owner_idx ON ticket (owner_id);
CREATE INDEX project_owner_idx ON project (owner_id);

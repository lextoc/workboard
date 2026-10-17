CREATE TABLE ticket (
    id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    status VARCHAR(255) NOT NULL,
    blocked BOOLEAN NOT NULL,
    blockedNote VARCHAR(1000),
    completedAt TIMESTAMP WITH TIME ZONE,

    CONSTRAINT ticket_pkey PRIMARY KEY (id),
    CONSTRAINT ticket_status_check
        CHECK ( status IN ('TODO', 'DOING', 'DONE') )
);

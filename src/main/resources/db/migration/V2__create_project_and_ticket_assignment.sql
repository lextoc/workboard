CREATE TABLE project (
    id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,

    CONSTRAINT project_pkey PRIMARY KEY (id)
);

ALTER TABLE ticket
    ADD COLUMN project_id UUID;

ALTER TABLE ticket
    ADD CONSTRAINT ticket_project_fkey
        FOREIGN KEY (project_id) REFERENCES project (id);

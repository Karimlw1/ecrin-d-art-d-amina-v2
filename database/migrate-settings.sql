USE ashion_store;

-- Run this once on an existing database.
ALTER TABLE users ADD COLUMN profile_image VARCHAR(500) NULL;
ALTER TABLE users ADD COLUMN theme ENUM('light','dark','system') NOT NULL DEFAULT 'system';
ALTER TABLE users ADD COLUMN language ENUM('fr','en') NOT NULL DEFAULT 'fr';
ALTER TABLE users ADD COLUMN currency ENUM('CDF','USD') NOT NULL DEFAULT 'CDF';

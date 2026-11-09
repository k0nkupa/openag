-- 'full' devices are treated as the owner by the gateway; 'limited' (the default) cannot use owner-only routes.
ALTER TABLE devices ADD COLUMN access TEXT NOT NULL DEFAULT 'limited' CHECK (access IN ('limited', 'full'));
ALTER TABLE pairing_codes ADD COLUMN access TEXT NOT NULL DEFAULT 'limited' CHECK (access IN ('limited', 'full'));

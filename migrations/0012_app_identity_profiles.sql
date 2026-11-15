ALTER TABLE app_registry ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE app_registry ADD COLUMN app_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE app_registry ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE app_registry ADD COLUMN contract_version TEXT NOT NULL DEFAULT '1.0.0';

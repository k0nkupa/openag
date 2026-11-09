ALTER TABLE rooms ADD COLUMN router_config_json TEXT CHECK (router_config_json IS NULL OR json_valid(router_config_json));

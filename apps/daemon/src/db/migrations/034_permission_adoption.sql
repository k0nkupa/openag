CREATE TABLE legacy_tool_modes AS SELECT * FROM tool_modes;
DROP TABLE tool_modes;
CREATE VIEW tool_modes AS SELECT * FROM legacy_tool_modes;
CREATE TRIGGER legacy_modes_no_insert BEFORE INSERT ON legacy_tool_modes BEGIN SELECT RAISE(ABORT,'Legacy permission archive is read-only'); END;
CREATE TRIGGER legacy_modes_no_update BEFORE UPDATE ON legacy_tool_modes BEGIN SELECT RAISE(ABORT,'Legacy permission archive is read-only'); END;
CREATE TRIGGER legacy_modes_no_delete BEFORE DELETE ON legacy_tool_modes BEGIN SELECT RAISE(ABORT,'Legacy permission archive is read-only'); END;
CREATE TABLE permission_adoption (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO permission_adoption SELECT 1,
  CASE WHEN NOT EXISTS(SELECT 1 FROM bots) AND NOT EXISTS(SELECT 1 FROM rooms) AND NOT EXISTS(SELECT 1 FROM events) AND NOT EXISTS(SELECT 1 FROM settings) AND NOT EXISTS(SELECT 1 FROM legacy_tool_modes) THEN 1 ELSE 0 END,
  1,'installation',0;

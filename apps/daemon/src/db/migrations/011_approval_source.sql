-- Where the turn that raised an approval came from (NULL = the desk). E.g. "slack:U0123456789".
ALTER TABLE approvals ADD COLUMN source TEXT;

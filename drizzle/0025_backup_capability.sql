INSERT INTO "role_capabilities" ("role_id", "capability")
SELECT "id", 'data.backup'
FROM "roles"
WHERE "key" = 'administrator'
ON CONFLICT ("role_id", "capability") DO NOTHING;

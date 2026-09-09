-- Backfill capabilities introduced after an administrator role was seeded.
-- Existing tenants must receive the same closed capability set as new tenants;
-- otherwise a valid feature is deployed but invisible to their administrators.
INSERT INTO role_capabilities (role_id, capability)
SELECT roles.id, capabilities.capability
FROM roles
CROSS JOIN (
  VALUES
    ('students.view'), ('students.manage'), ('students.nationality'), ('students.degree'),
    ('students.sensitive.read'), ('professors.view'), ('professors.manage'),
    ('professors.sensitive.read'), ('professors.bank.read'), ('council.view'),
    ('council.manage'), ('capacity.view'), ('capacity.manage'), ('worksheets.view'),
    ('worksheets.manage'), ('workshops.view'), ('workshops.manage'), ('calendar.view'),
    ('calendar.manage'), ('master-data.manage'), ('documents.view'), ('documents.manage'),
    ('correspondence.view'), ('correspondence.manage'), ('tasks.view'), ('tasks.manage'),
    ('notifications.manage'), ('research-projects.view'), ('research-projects.manage'),
    ('lookups.manage'), ('institution.manage'), ('users.manage'), ('roles.manage'),
    ('saved-views.publish'), ('templates.manage'), ('regulations.manage'), ('features.manage'),
    ('custom-fields.manage'), ('integrations.manage'), ('api.manage'), ('reports.schedule'),
    ('retention.manage'), ('security.break-glass'), ('audit.view'), ('data.export'),
    ('data.quality.view'), ('data.quality.manage')
) AS capabilities(capability)
WHERE roles.key = 'administrator'
ON CONFLICT (role_id, capability) DO NOTHING;

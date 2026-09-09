-- Failed provisioning recovery is a privileged, explicitly confirmed queue
-- operation. Keep the allow-list in the canonical after-SQL layer as well as
-- the Drizzle model so existing databases receive the contract on migrate.
ALTER TABLE platform_operation_requests
  DROP CONSTRAINT IF EXISTS platform_operation_requests_kind_check;
--> statement-breakpoint
ALTER TABLE platform_operation_requests
  ADD CONSTRAINT platform_operation_requests_kind_check CHECK (kind IN (
    'tenant.create',
    'tenant.rename',
    'tenant.suspend',
    'tenant.resume',
    'tenant.archive',
    'tenant.failed.purge',
    'tenant.owner.set',
    'tenant.user.create',
    'tenant.user.password.reset',
    'backup.create',
    'backup.verify',
    'break-glass.start',
    'break-glass.end',
    'platform.operation.retry',
    'platform.operation.cancel'
  ));

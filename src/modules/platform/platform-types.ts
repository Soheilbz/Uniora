export interface PlatformTenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  provisioningStatus: string;
  provisioningRequestId: string | null;
  createdAt: Date;
  manager: {
    name: string;
    username: string;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
    suspendedAt: Date | null;
    lastLoginAt: Date | null;
  } | null;
  accounts: Array<{
    name: string;
    username: string;
    isOwner: boolean;
    mustChangePassword: boolean;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    mfaEnabled: boolean;
    lastLoginAt: Date | null;
    accountExpiresAt: Date | null;
  }>;
  accountCount: number;
  activeAccountCount: number;
  suspendedAccountCount: number;
  metrics: {
    activeUsers: number;
    suspendedUsers: number;
    students: number;
    professors: number;
    meetings: number;
    decisions: number;
    attachments: number;
    attachmentBytes: number;
  };
}

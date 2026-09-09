import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { auth } from "@/lib/auth.ts";
import { requireViewer } from "@/lib/viewer.ts";

export interface ProfileView {
  name: string;
  username: string | null;
  email: string;
}

export async function readProfile(): Promise<ProfileView> {
  const viewer = await requireViewer();
  const [account] = await readOnly(viewer.tenantId, (tx) =>
    tx
      .select({ name: user.name, username: user.displayUsername, email: user.email })
      .from(user)
      .where(eq(user.id, viewer.userId))
      .limit(1),
  );
  return {
    name: account?.name ?? viewer.name,
    username: account?.username ?? null,
    email: account?.email && !account.email.endsWith("@users.invalid") ? account.email : "",
  };
}

export interface DeviceView {
  id: string;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

export async function readDevices(): Promise<DeviceView[]> {
  await requireViewer();
  const requestHeaders = await headers();
  const [listed, current] = await Promise.all([
    auth.api.listSessions({ headers: requestHeaders }),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  const currentToken = current?.session?.token;
  return [...listed]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((one) => ({
      id: one.id,
      createdAt: one.createdAt,
      ipAddress: one.ipAddress ?? null,
      userAgent: one.userAgent ?? null,
      current: one.token === currentToken,
    }));
}

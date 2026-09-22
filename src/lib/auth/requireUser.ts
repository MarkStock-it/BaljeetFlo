import { cookies } from "next/headers";
import { getStore } from "@/lib/store";
import type { UserRow } from "@/lib/store/types";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function requireUser(): Promise<UserRow | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  return getStore().getUserById(userId);
}

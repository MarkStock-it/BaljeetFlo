import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { hashPassword, verifyPassword } from "@/lib/bcrypt";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

const uuid = () => globalThis.crypto.randomUUID();

export async function POST(req: Request) {
  const { action, username, password } = (await req.json()) as {
    action: "register" | "login" | "logout";
    username?: string;
    password?: string;
  };

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  if (!username || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Username and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }
  const store = getStore();

  if (action === "register") {
    if (await store.getUserByUsername(username)) {
      return NextResponse.json({ error: "Username already taken." }, { status: 409 });
    }
    const user = await store.createUser({
      id: uuid(),
      username,
      passwordHash: hashPassword(password),
    });
    return await setSession(user.id);
  }

  // login
  const user = await store.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  return await setSession(user.id);
}

export async function GET() {
  const cookie = (await import("next/headers")).cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) return NextResponse.json({ user: null });
  const { verifySessionToken } = await import("@/lib/auth/session");
  const userId = await verifySessionToken(cookie);
  if (!userId) return NextResponse.json({ user: null });
  const user = await getStore().getUserById(userId);
  return NextResponse.json({
    user: user
      ? { id: user.id, username: user.username, onboardingDone: user.onboardingDone }
      : null,
  });
}

async function setSession(userId: string) {
  const res = NextResponse.json({ ok: true });
  const token = await createSessionToken(userId);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false, // serve over LAN HTTP for phone testing; set true behind HTTPS
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}

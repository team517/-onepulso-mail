import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "onepulso_session",
    value: "",
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

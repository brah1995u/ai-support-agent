import { NextResponse, type NextRequest } from "next/server";

/**
 * Operator login for public deployments: /dashboard?token=<OPERATOR_TOKEN> stores the token
 * in an httpOnly cookie and redirects to a clean URL. The API checks that cookie (or a
 * Bearer header). Without OPERATOR_TOKEN the console is open, which suits local demos.
 */
export function proxy(request: NextRequest) {
  const expected = process.env.OPERATOR_TOKEN;
  const token = request.nextUrl.searchParams.get("token");
  if (!expected || !token) return NextResponse.next();

  const clean = request.nextUrl.clone();
  clean.searchParams.delete("token");
  const response = NextResponse.redirect(clean);
  if (token === expected) {
    response.cookies.set("operator_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return response;
}

export const config = { matcher: ["/dashboard"] };

import { NextResponse, type NextRequest } from "next/server";

const writeMethods = new Set(["POST", "PATCH", "DELETE"]);
const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/i;

function loopbackOrigin(authority: string | null) {
  const match = authority?.match(loopbackHost);
  if (!match) return null;
  const port = match[2] === undefined ? 80 : Number(match[2]);
  if (port < 1 || port > 65535) return null;
  const hostname = match[1].toLowerCase();
  return port === 80 ? `http://${hostname}` : `http://${hostname}:${port}`;
}

export function proxy(request: NextRequest) {
  if (!writeMethods.has(request.method)) return NextResponse.next();

  const destination = loopbackOrigin(request.headers.get("host"));
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const originAuthority = origin?.match(/^http:\/\/(.+)$/i)?.[1] ?? null;
  if (!destination || (origin !== null && loopbackOrigin(originAuthority) !== destination) ||
      (site !== null && site !== "same-origin")) {
    return NextResponse.json({ error: "Yêu cầu ghi phải đến từ địa chỉ OpenNote cục bộ" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };

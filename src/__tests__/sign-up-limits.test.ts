/**
 * Open signup (POST /api/auth/sign-up/email) is capped per IP per hour, per IP
 * per day, and site-wide per hour (counted in the database). Sign-in is not
 * affected by the site-wide signup cap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let openSignUps = 0;
const handlerPost = vi.fn(async () => new Response("ok", { status: 200 }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ n: openSignUps }] }) }),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: vi.fn(), POST: handlerPost }),
}));

const { POST } = await import("@/app/api/auth/[...all]/route");

// Each test uses fresh IPs so in-memory buckets from other tests never apply.
let ipBlock = 0;
const nextIp = () => `10.1.${++ipBlock}.1`;
const post = (path: string, ip: string) =>
  POST(new Request(`http://localhost/api/auth/${path}`, { method: "POST", headers: { "x-forwarded-for": ip } }));

beforeEach(() => {
  openSignUps = 0;
  handlerPost.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("sign-up rate limits", () => {
  it("lets a signup through when under every cap", async () => {
    const res = await post("sign-up/email", nextIp());
    expect(res.status).toBe(200);
    expect(handlerPost).toHaveBeenCalledTimes(1);
  });

  it("blocks the sixth signup from one IP within an hour", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect((await post("sign-up/email", ip)).status).toBe(200);
    const res = await post("sign-up/email", ip);
    expect(res.status).toBe(429);
    expect(handlerPost).toHaveBeenCalledTimes(5);
  });

  it("blocks the eleventh signup from one IP within a day, even spread across hours", async () => {
    vi.useFakeTimers();
    const ip = nextIp();
    for (let hour = 0; hour < 2; hour++) {
      for (let i = 0; i < 5; i++) expect((await post("sign-up/email", ip)).status).toBe(200);
      vi.advanceTimersByTime(61 * 60_000);
    }
    expect((await post("sign-up/email", ip)).status).toBe(429);
    expect(handlerPost).toHaveBeenCalledTimes(10);
  });

  it("blocks every IP once the site-wide hourly cap is reached", async () => {
    openSignUps = 20;
    const res = await post("sign-up/email", nextIp());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect(handlerPost).not.toHaveBeenCalled();
  });

  it("does not apply the site-wide signup cap to sign-in", async () => {
    openSignUps = 999;
    const res = await post("sign-in/email", nextIp());
    expect(res.status).toBe(200);
  });
});

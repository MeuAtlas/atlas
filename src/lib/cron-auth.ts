import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(
  request: Request,
  configuredSecret = process.env.CRON_SECRET,
) {
  const received = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || !received) return false;
  const expected = Buffer.from(configuredSecret);
  const actual = Buffer.from(received);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

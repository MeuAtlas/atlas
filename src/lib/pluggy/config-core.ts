export type PluggyEnvironment = Record<string, string | undefined>;

export function readPluggyConfig(env: PluggyEnvironment) {
  const clientId = env.PLUGGY_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim() ?? "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

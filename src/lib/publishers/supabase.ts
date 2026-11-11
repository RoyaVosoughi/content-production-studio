// One Supabase project can serve two jobs: a blog table the website reads (when the website is posted to
// through Supabase), and a public image folder Instagram fetches slides from. Both use these settings.
// WEBSITE_SUPABASE_URL and WEBSITE_SUPABASE_KEY are older names, still read so existing setups keep working.

export const SUPABASE_URL_SETTING = "SUPABASE_URL";
export const SUPABASE_KEY_SETTING = "SUPABASE_SECRET_KEY";

export function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.WEBSITE_SUPABASE_URL || "").replace(/\/+$/, "");
}

function supabaseKey(): string {
  return process.env.SUPABASE_SECRET_KEY || process.env.WEBSITE_SUPABASE_KEY || "";
}

/** The settings still missing, by their current names. */
export function missingSupabase(): string[] {
  return [
    ...(supabaseUrl() ? [] : [SUPABASE_URL_SETTING]),
    ...(supabaseKey() ? [] : [SUPABASE_KEY_SETTING]),
  ];
}

export function supabaseHeaders(): Record<string, string> {
  const key = supabaseKey();
  // New sb_secret_ keys are not JWTs and belong only in apikey. Older service_role keys are JWTs and need both.
  return {
    apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  };
}

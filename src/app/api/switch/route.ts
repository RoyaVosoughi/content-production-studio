import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { isUiLanguage } from "@/lib/language";
import { getProfile } from "@/lib/profile";
import { VIEW_COOKIE } from "@/lib/view";

/**
 * Switches the interface language (?ui=), the content language on screen (?content=), or both, then
 * returns to the same page (?back=, the address after the language). Choosing an interface language
 * that is also a content language shows that language's content too.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ui = url.searchParams.get("ui") ?? "en";
  const back = url.searchParams.get("back") ?? "";
  const language = isUiLanguage(ui) ? ui : "en";
  // Only a path on this site, so the switch can never send anyone elsewhere.
  const path = back.startsWith("/") && !back.startsWith("//") ? back : "";

  const languages = (await getProfile(await getDb()))?.languages ?? [];
  const content = url.searchParams.get("content");
  const chosen = content && languages.includes(content) ? content : languages.includes(language) ? language : null;
  if (chosen) {
    (await cookies()).set(VIEW_COOKIE, chosen, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  }
  // A relative address keeps the browser on the same host, so the cookie just set comes along.
  return new Response(null, { status: 303, headers: { Location: `/${language}${path}` } });
}

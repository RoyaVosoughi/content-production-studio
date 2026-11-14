"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UiLanguage } from "@/lib/language";
import type { Strings } from "@/lib/i18n";

const OPTIONS: { value: UiLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fa", label: "فارسی" },
];

/** The address of a language switch that comes back to this same page. */
function switchHref(ui: UiLanguage, back: string) {
  return `/api/switch?${new URLSearchParams({ ui, back })}`;
}

export type SectionId = "ideas" | "team" | "results" | "brand" | "connections" | "setup";

const OTHER_SECTIONS: SectionId[] = ["team", "results", "brand", "connections", "setup"];

/** Which section a path belongs to, and whether it is that section's top page. */
export function sectionOf(pathname: string, language: UiLanguage): { id: SectionId; top: boolean } {
  const on = (part: string) => pathname.endsWith(`/${part}`) || pathname.includes(`/${part}/`);
  const id = OTHER_SECTIONS.find(on) ?? "ideas";
  const top = id === "ideas" ? pathname === `/${language}` : pathname.endsWith(`/${id}`);
  return { id, top };
}

function sections(language: UiLanguage, t: Strings, ready: boolean) {
  // Until Setup is saved, Setup is the only place to go. After that, Setup is reached from the Agents page.
  if (!ready) return [{ id: "setup" as SectionId, href: `/${language}/setup`, label: t.navSetup }];
  const all: { id: SectionId; href: string; label: string }[] = [
    { id: "brand", href: `/${language}/brand`, label: t.navBrand },
    { id: "ideas", href: `/${language}`, label: t.navStudio },
    { id: "team", href: `/${language}/team`, label: t.navTeam },
    { id: "results", href: `/${language}/results`, label: t.navResults },
    { id: "connections", href: `/${language}/connections`, label: t.navConnections },
  ];
  return all;
}

/** The floating pill menu in the middle of the top bar. */
export function TopMenu({ language, t, ready }: { language: UiLanguage; t: Strings; ready: boolean }) {
  const pathname = usePathname();
  const here = sectionOf(pathname, language);
  return (
    <nav aria-label={t.studio} className="order-3 w-full md:order-2 md:flex md:w-auto md:flex-1 md:justify-center">
      <div className="nav-pill nav-scroll flex max-w-full gap-0.5 overflow-x-auto p-1 md:w-fit">
        {sections(language, t, ready).map((section) => (
          <Link
            key={section.id}
            href={section.href}
            aria-current={section.id === here.id ? "page" : undefined}
            className="nav-link"
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** The interface language switch at the far end of the top bar. It also switches the content shown. */
export function LanguageSwitches({ language, t }: { language: UiLanguage; t: Strings }) {
  const pathname = usePathname();
  const rest = pathname.slice(language.length + 1);
  return (
    <div className="order-2 ms-auto flex shrink-0 flex-wrap items-center justify-end gap-2 md:order-3 md:ms-0">
      <div className="switch items-center" role="group" aria-label={t.language} title={t.language}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" className="mx-1.5 text-fog" aria-hidden>
          <circle cx="8" cy="8" r="6.3" />
          <path d="M1.8 8h12.4M8 1.7c1.8 1.8 2.6 3.9 2.6 6.3S9.8 12.5 8 14.3C6.2 12.5 5.4 10.4 5.4 8S6.2 3.5 8 1.7Z" />
        </svg>
        {OPTIONS.map((option) => (
          <a
            key={option.value}
            lang={option.value}
            // Same page in the other language. An idea's page shows that language's version when there is one.
            href={switchHref(option.value, rest)}
            aria-current={option.value === language ? "true" : undefined}
          >
            {option.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** The pill badge above a section's headline, shown on the top page of each section. */
export function SectionBadge({ language, t, ready }: { language: UiLanguage; t: Strings; ready: boolean }) {
  const pathname = usePathname();
  const here = sectionOf(pathname, language);
  const item = sections(language, t, ready).find((section) => section.id === here.id);
  if (!item || !here.top) return null;
  return (
    <p className="section-badge">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
        <path d="M8 0c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Zm5 10c.2 1.9 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1.1 3-3Z" />
      </svg>
      {item.label}
    </p>
  );
}

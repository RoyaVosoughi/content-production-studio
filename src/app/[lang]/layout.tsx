import Link from "next/link";
import type { ReactNode } from "react";
import { HeroArt } from "@/components/hero-art";
import { LanguageSwitches, SectionBadge, TopMenu } from "@/components/rail-nav";
import { Spotlight } from "@/components/spotlight";
import { uiDirection } from "@/lib/language";
import { studioPage } from "@/lib/view";

export default async function StudioLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  // The layout never sends anyone to Setup itself, so the Setup page can use it too.
  const { ui, t, profile } = await studioPage(lang, { setup: true });
  const ready = Boolean(profile);

  return (
    <div lang={ui} dir={uiDirection(ui)} className="min-h-dvh">
      {/* The night sky behind everything: a rising glow, a horizon line, three drifting star layers and two light beams. */}
      <div className="sky" aria-hidden>
        <div className="sky-glow" />
        <div className="sky-horizon" />
        <div className="stars stars-small" />
        <div className="stars stars-medium" />
        <div className="stars stars-big" />
        <div className="sky-beams" />
      </div>
      <Spotlight />

      <div className="studio-shell">
        <header className="topbar">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 md:flex-nowrap md:px-6">
            <Link href={ready ? `/${ui}` : `/${ui}/setup`} className="flex min-w-0 items-center gap-2.5">
              <span className="brand-mark" aria-hidden>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="8.5" strokeOpacity="0.55" />
                  <path d="M7 9.5 11 7l5 3.5-2 5.5-5.5 1L7 9.5Z" strokeLinejoin="round" />
                  <circle cx="11" cy="7" r="1.2" fill="#fff" stroke="none" />
                  <circle cx="16" cy="10.5" r="1.2" fill="#fff" stroke="none" />
                  <circle cx="8.5" cy="17" r="1.2" fill="#fff" stroke="none" />
                </svg>
              </span>
              <span className="min-w-0 truncate text-[0.95rem] font-medium leading-tight">{t.studio}</span>
            </Link>
            <TopMenu language={ui} t={t} ready={ready} />
            <LanguageSwitches language={ui} t={t} />
          </div>
        </header>
        <main className="min-w-0 px-4 pb-24 pt-10 md:px-10 md:pt-16">
          <div className="page mx-auto max-w-3xl">
            <HeroArt language={ui} />
            <SectionBadge language={ui} t={t} ready={ready} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

import { SetupForm } from "@/components/setup-form";
import { studioPage } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function SetupPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const { ui, t, profile } = await studioPage(lang, { setup: true });

  return (
    <>
      <h1 className="font-display text-4xl leading-tight md:text-5xl">{t.setupPageTitle}</h1>
      {!profile && <p className="mt-4 rounded-lg border-s-4 border-cobalt bg-paper p-3 text-sm">{t.setupNeeded}</p>}
      <p className="mt-3 max-w-xl text-ink-soft">{t.setupIntro}</p>
      <SetupForm profile={profile} ui={ui} t={t} />
    </>
  );
}

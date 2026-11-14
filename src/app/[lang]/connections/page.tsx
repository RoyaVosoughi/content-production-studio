import type { ReactNode } from "react";
import { AiSection } from "@/components/ai-section";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";
import { platformLabel, type Platform } from "@/lib/platforms";
import { PUBLISHERS } from "@/lib/publishers";
import { checkInstagram } from "@/lib/publishers/instagram";
import { checkLinkedIn } from "@/lib/publishers/linkedin";
import { checkStorage } from "@/lib/publishers/storage";
import { checkTelegram } from "@/lib/publishers/telegram";
import { checkWebsite, websiteMode } from "@/lib/publishers/website";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

type Health = "connected" | "notSetUp" | "needsAttention";

export default async function ConnectionsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, profile, db } = await readyPage(param);

  const token = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const instagramReady = PUBLISHERS.instagram.missingSettings().length === 0;
  const [telegram, linkedin, website, instagram, storageProblem] = await Promise.all([
    token ? checkTelegram() : null,
    process.env.LINKEDIN_ACCESS_TOKEN ? checkLinkedIn() : null,
    PUBLISHERS.website.missingSettings().length === 0 ? checkWebsite() : null,
    instagramReady ? checkInstagram() : null,
    instagramReady ? checkStorage() : null,
  ]);
  const instagramProblem = instagram?.problem ?? storageProblem ?? null;

  const telegramHealth: Health = !token
    ? "notSetUp"
    : telegram?.problem
      ? "needsAttention"
      : telegram?.canPost
        ? "connected"
        : "notSetUp";

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight">{t.connectionsTitle}</h1>
      <p className="mt-3 max-w-xl text-ink-soft">{t.connectionsIntro}</p>

      <div className="mt-6 space-y-4">
        <AiSection db={db} ui={lang} t={t} />
        <Card platform="telegram" health={telegramHealth} help={t.telegramHelp} problem={telegram?.problem} language={lang} t={t}>
          {telegram?.botName && <Fact label={t.botLabel} value={telegram.botName} />}
          {telegram?.channelName && <Fact label={t.channelLabel} value={telegram.channelName} />}
          {token && !process.env.TELEGRAM_CHANNEL_ID && telegram && !telegram.problem && (
            telegram.foundChannels.length > 0 ? (
              <div className="text-sm">
                <p>{t.channelsFound}</p>
                <ul className="mt-1 font-[family-name:var(--font-jetbrains)]" dir="ltr">
                  {telegram.foundChannels.map((channel) => (
                    <li key={channel.id}>
                      <bdi>{channel.title}</bdi>: {channel.id}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm font-medium">{t.noChannelsFound}</p>
            )
          )}
        </Card>

        <Card
          platform="linkedin"
          health={!linkedin ? "notSetUp" : linkedin.problem ? "needsAttention" : "connected"}
          help={t.linkedinHelp}
          problem={linkedin?.problem}
          language={lang}
          t={t}
        >
          {linkedin?.name && <Fact label={t.profileLabel} value={linkedin.name} />}
        </Card>

        <Card
          platform="instagram"
          health={!instagram ? "notSetUp" : instagramProblem ? "needsAttention" : "connected"}
          help={t.instagramHelp}
          problem={instagramProblem}
          language={lang}
          t={t}
        >
          {instagram?.username && <Fact label={t.accountLabel} value={instagram.username} />}
          <p className="text-sm text-ink-soft">{t.instagramImagesNote}</p>
        </Card>

        <Card
          platform="website"
          health={!website ? "notSetUp" : website.problem ? "needsAttention" : "connected"}
          help={t.websiteHelp}
          problem={website?.problem}
          language={lang}
          t={t}
        >
          {website && !website.problem && (
            <p className="text-sm">{websiteMode() === "webhook" ? t.websiteByWebhook : t.websiteBySupabase}</p>
          )}
          {!profile.websiteUrl && <p className="text-sm text-ink-soft">{t.websiteNoAddress}</p>}
        </Card>
      </div>
    </>
  );
}

function Card({
  platform,
  health,
  help,
  problem,
  language,
  t,
  children,
}: {
  platform: Platform;
  health: Health;
  help: string;
  problem?: string | null;
  language: UiLanguage;
  t: Strings;
  children?: ReactNode;
}) {
  const missing = PUBLISHERS[platform].missingSettings();
  const labels = { connected: t.connected, notSetUp: t.notSetUp, needsAttention: t.needsAttention };
  const colors = { connected: "text-cobalt", notSetUp: "text-ink-soft", needsAttention: "text-danger" };
  return (
    <section className="space-y-2 rounded-xl bg-paper p-5 md:p-6" data-connection={platform}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{platformLabel(platform, language)}</h2>
        <span className={`text-sm font-semibold ${colors[health]}`}>{labels[health]}</span>
      </div>
      {children}
      {problem && (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-sm">
          {t.missingSettings}{" "}
          <span dir="ltr" className="font-[family-name:var(--font-jetbrains)]">
            {missing.join(", ")}
          </span>
        </p>
      )}
      {health !== "connected" && <p className="text-sm text-ink-soft">{help}</p>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="label">{label}: </span>
      <bdi className="font-medium">{value}</bdi>
    </p>
  );
}

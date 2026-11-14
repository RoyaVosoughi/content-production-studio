import Link from "next/link";
import { createAnimationAction, quickVideoAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { listAnimations, SCRIPT_LIMIT } from "@/lib/animations";
import { textDirection, uiLocale } from "@/lib/language";
import { platformLabel, VIDEO_PLATFORMS, type VideoPlatform } from "@/lib/platforms";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Videos that don't start from an idea: a talking-head clip you filmed, edited and captioned, or an
 * animation made from any script. Both use the brand's style, and both run on this computer.
 */
export default async function VideoStudioPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: param } = await params;
  const { ui: lang, t, db, view } = await readyPage(param);
  const v = t.videoStudio;
  const dir = textDirection(view);
  const rows = await listAnimations(db, view);

  const platformField = (fallback: VideoPlatform) => (
    <label className="block">
      <span className="label mb-1 block">{v.platformLabel}</span>
      <select name="platform" defaultValue={fallback} className="field">
        {VIDEO_PLATFORMS.map((platform) => (
          <option key={platform} value={platform}>
            {platformLabel(platform, lang)}
          </option>
        ))}
      </select>
    </label>
  );
  const titleField = (
    <label className="block">
      <span className="label mb-1 block">{v.titleLabel}</span>
      <input name="title" maxLength={100} placeholder={v.titlePlaceholder} dir={dir} className="field" />
    </label>
  );
  const status = (row: (typeof rows)[number]) =>
    row.renderStatus === "ready" ? v.statusReady : row.renderStatus === "working" ? v.statusWorking : row.renderStatus === "failed" ? v.statusFailed : v.statusDraft;

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{v.title}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{v.intro}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section id="talking-head" className="scroll-mt-24 rounded-xl bg-paper p-5 md:p-6">
          <h2 className="font-display text-2xl font-semibold">{v.headTitle}</h2>
          <p className="mt-2 text-sm text-ink-soft">{v.headIntro}</p>
          <ActionForm action={quickVideoAction} className="mt-5 space-y-4">
            <input type="hidden" name="language" value={view} />
            <input type="hidden" name="ui" value={lang} />
            <div className="grid gap-4 sm:grid-cols-2">
              {titleField}
              {platformField("reel")}
            </div>
            <label className="block">
              <span className="label mb-1 block">{v.sayLabel}</span>
              <span className="mb-1 block text-xs text-ink-soft">{v.sayHint}</span>
              <textarea name="script" rows={4} dir={dir} className="field" />
            </label>
            <p className="text-sm text-ink-soft">{v.headSteps}</p>
            <SubmitButton pendingLabel={v.starting} className="btn-primary">
              {v.start}
            </SubmitButton>
          </ActionForm>
        </section>

        <section id="animate" className="scroll-mt-24 rounded-xl bg-paper p-5 md:p-6">
          <h2 className="font-display text-2xl font-semibold">{v.animTitle}</h2>
          <p className="mt-2 text-sm text-ink-soft">{v.animIntro}</p>
          <ActionForm action={createAnimationAction} className="mt-5 space-y-4">
            <input type="hidden" name="language" value={view} />
            <input type="hidden" name="ui" value={lang} />
            <div className="grid gap-4 sm:grid-cols-2">
              {titleField}
              {platformField("reel")}
            </div>
            <label className="block">
              <span className="label mb-1 block">{v.scriptLabel}</span>
              <span className="mb-1 block text-xs text-ink-soft">{v.scriptHint.replace("{count}", SCRIPT_LIMIT.toLocaleString(uiLocale(lang)))}</span>
              <textarea name="script" rows={8} maxLength={SCRIPT_LIMIT} required dir={dir} className="field" />
            </label>
            <p className="text-sm text-ink-soft">{v.animVoice}</p>
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel={v.planning} className="btn-primary" name="mode" value="ai">
                {v.planAi}
              </SubmitButton>
              <SubmitButton pendingLabel={v.planning} name="mode" value="simple">
                {v.planSimple}
              </SubmitButton>
            </div>
          </ActionForm>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold">{v.yours}</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{v.none}</p>
        ) : (
          <ul className="mt-3 divide-y divide-mist rounded-xl border border-mist">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/${lang}/video/${row.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-paper">
                  <bdi className="min-w-0 flex-1 font-semibold" dir={dir}>
                    {row.title}
                  </bdi>
                  <span className="text-sm text-ink-soft">{platformLabel(row.platform as VideoPlatform, lang)}</span>
                  <span className="text-sm text-ink-soft">
                    {row.scenes.length} · {status(row)}
                  </span>
                  <span className="label">{row.updatedAt.toLocaleDateString(uiLocale(lang))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

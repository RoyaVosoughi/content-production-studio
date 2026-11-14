import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAnimationAction, replanAnimationAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  MakePanel,
  NarrationPanel,
  PlanningNote,
  SceneEditor,
} from "@/components/animation-editor";
import { animationState } from "@/lib/animations";
import { clock } from "@/lib/video/animation";
import { textDirection } from "@/lib/language";
import { VIDEO_FORMATS, type VideoPlatform } from "@/lib/platforms";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One animation: its scenes to change, the narration, a live preview, and the finished video. */
export default async function AnimationPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang: param, id } = await params;
  const { ui: lang, t, db } = await readyPage(param);
  if (!UUID.test(id)) notFound();
  const state = await animationState(db, id).catch(() => null);
  if (!state) notFound();
  const { row } = state;
  const v = t.videoStudio;
  const platform = row.platform as VideoPlatform;
  const { width, height } = VIDEO_FORMATS[platform];
  const dir = textDirection(row.language);
  const version = row.updatedAt.getTime();

  return (
    <>
      <Link
        href={`/${lang}/video`}
        className="text-sm font-medium text-cobalt hover:underline"
      >
        {lang === "fa" ? "→" : "←"} {v.back}
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold leading-tight md:text-4xl">
        <bdi dir={dir}>{row.title}</bdi>
      </h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {(state.planning ||
            state.planStopped ||
            row.planStatus === "failed") && (
            <PlanningNote
              id={row.id}
              planning={state.planning}
              error={state.planStopped ? v.planStopped : row.planError}
              t={t}
            />
          )}
          {!state.planning && (
            <SceneEditor
              key={version}
              id={row.id}
              title={row.title}
              platform={platform}
              captions={row.captions}
              scenes={row.scenes}
              dir={dir}
              ui={lang}
              t={t}
            />
          )}

          <details className="rounded-xl border border-mist p-4">
            <summary className="cursor-pointer font-semibold">
              {v.script}
            </summary>
            <p dir={dir} className="mt-3 whitespace-pre-wrap text-sm">
              {row.script}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{v.replan}:</span>
              <ActionForm
                action={replanAnimationAction}
                className="flex flex-wrap gap-2"
              >
                <input type="hidden" name="id" value={row.id} />
                <SubmitButton pendingLabel={v.planning} name="mode" value="ai">
                  {v.replanAi}
                </SubmitButton>
                <SubmitButton
                  pendingLabel={v.planning}
                  name="mode"
                  value="simple"
                >
                  {v.replanSimple}
                </SubmitButton>
              </ActionForm>
              <span className="text-xs text-ink-soft">{v.replanWarn}</span>
            </div>
          </details>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <section className="rounded-xl bg-paper p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{v.preview}</h2>
              <span className="label">
                {v.length.replace("{length}", clock(state.duration, lang))}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-soft">{v.previewHint}</p>
            <iframe
              key={version}
              title={v.preview}
              src={`/api/animations/${row.id}/preview?ui=${lang}&v=${version}`}
              className="mx-auto mt-3 block w-full max-w-[340px] rounded-lg border-0 bg-black"
              style={{ aspectRatio: `${width} / ${height}` }}
            />
          </section>
          <MakePanel
            id={row.id}
            render={{
              ready: state.ready,
              working: state.working,
              stopped: state.stopped,
              failed:
                row.renderKey === state.key && row.renderStatus === "failed"
                  ? row.renderError
                  : null,
              progress: row.renderProgress,
              problem: state.problem,
              key: state.key,
            }}
            ui={lang}
            t={t}
          />
          <NarrationPanel
            id={row.id}
            narration={{
              name: row.narrationName,
              status: row.narrationStatus,
              stage: row.narrationStage,
              progress: row.narrationProgress,
              error: row.narrationError,
              duration: row.narrationDuration,
              stopped: state.narrationStopped,
            }}
            ui={lang}
            t={t}
          />
          <details className="rounded-xl border border-mist p-4 text-sm">
            <summary className="cursor-pointer text-ink-soft">
              {v.delete}
            </summary>
            <ActionForm
              action={deleteAnimationAction}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="ui" value={lang} />
              <span>{v.deleteSure}</span>
              <SubmitButton pendingLabel={v.deleteYes}>
                {v.deleteYes}
              </SubmitButton>
            </ActionForm>
          </details>
        </aside>
      </div>
    </>
  );
}

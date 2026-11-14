import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createPiecesAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { IdeaMap } from "@/components/idea-map";
import { ManagerNote } from "@/components/manager-note";
import { PieceEditor } from "@/components/piece-editor";
import { PostTabs, type PostTab } from "@/components/post-tabs";
import { RemovePiece } from "@/components/remove-piece";
import { latestVerdicts } from "@/lib/agents/team";
import { VideoEditor, type EditorVideo } from "@/components/video-editor";
import { approvedLanguages, canDeleteLive, getPieces, ideaForContentPage, publishState, videoState } from "@/lib/content";
import { localize } from "@/lib/i18n";
import { languageName, textDirection, type Language } from "@/lib/language";
import { articleUrl, displayName, headline, instagramLabel } from "@/lib/profile";
import { slideBrand } from "@/lib/slides";
import { readyPage } from "@/lib/view";
import { Stepper } from "@/components/stepper";
import { studioProgress } from "@/lib/progress";
import { isPlatform, isVideoPlatform, platformLabel, PLATFORMS, TEXT_PLATFORMS, VIDEO_PLATFORMS, type Platform } from "@/lib/platforms";
import { PUBLISHERS } from "@/lib/publishers";
import { getScenario, getSibling } from "@/lib/studio";
import { channelOrder } from "@/lib/channels";
import { localTimeValue, schedulesFor, type Schedule } from "@/lib/schedule";
import { scheduleLabel } from "@/lib/schedule-time";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContentPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang: param, id } = await params;
  const { ui: lang, db, view, languages: contentLanguages, profile } = await readyPage(param);
  if (!UUID.test(id)) notFound();

  const idea = await ideaForContentPage(db, id);
  if (!idea) notFound();
  const sibling = await getSibling(db, idea);
  // The language switches keep the same id in the address, so send it to the version on screen.
  if (idea.language !== view && sibling?.language === view) redirect(`/${lang}/ideas/${sibling.id}/content`);

  // lang is the interface language; language is the one this idea is written in.
  const language: Language = idea.language;
  const t = localize(lang, contentLanguages, language);
  const brandFor = (slug?: string) => ({
    name: displayName(profile, language),
    headline: headline(profile, language),
    instagram: instagramLabel(profile).replace(/^@/, ""),
    slides: slideBrand(profile),
    websiteUrl: profile.websiteUrl,
    articleUrl: slug ? articleUrl(profile, language, slug) : null,
  });
  const approved = await approvedLanguages(db, idea);
  const ready = approved.length > 0;
  const pieces = await getPieces(db, id);
  const otherPieces = sibling ? await getPieces(db, sibling.id) : [];
  const schedules = await schedulesFor(db, pieces.map((piece) => piece.id));
  const scheduleView = (row: Schedule | undefined) =>
    row ? { status: row.status, version: row.version, value: localTimeValue(row.at), label: scheduleLabel(row.at, lang), error: row.error } : null;
  const scenario = await getScenario(db, id);
  const verdicts = await latestVerdicts(db, pieces.map((piece) => piece.id));
  const written: Record<string, Set<string>> = {
    [language]: new Set(pieces.map((piece) => piece.platform)),
    ...(sibling ? { [sibling.language]: new Set(otherPieces.map((piece) => piece.platform)) } : {}),
  };
  // A platform is offered while some approved language doesn't have it yet.
  const available = PLATFORMS.filter((platform) => approved.some((code) => !written[code]?.has(platform)));
  // This page's language first; the other one only once the idea has it.
  const languages: Language[] = sibling ? [language, sibling.language] : [language];
  const defaultLanguage = approved.includes(language) ? language : approved[0];
  const origins = { ai: t.originAi, edit: t.originEdit, "ai-change": t.originAiChange, restore: t.originRestore };
  // Posts first, then videos, each in the order of the platform list.
  const editors = await Promise.all(
    pieces
      .filter((piece) => isPlatform(piece.platform))
      .sort((a, b) => PLATFORMS.indexOf(a.platform as Platform) - PLATFORMS.indexOf(b.platform as Platform))
      .map(async (piece) => {
        const platform = piece.platform as Platform;
        const other = otherPieces.find((candidate) => candidate.platform === piece.platform);
        let video: EditorVideo | null = null;
        if (isVideoPlatform(platform)) {
          const state = await videoState(db, piece.id, platform, language, piece.current.content);
          video = {
            clip: state.clip && {
              id: state.clip.id,
              status: state.clip.status,
              stage: state.clip.stage,
              progress: state.clip.progress,
              error: state.clip.error,
              stopped: state.clip.stopped,
              duration: state.clip.duration,
              originalName: state.clip.originalName,
              phrases: state.clip.phrases,
            },
            otherClips: state.otherClips.map(({ id, originalName, duration }) => ({ id, originalName, duration })),
            render: state.render && {
              status: state.render.status,
              progress: state.render.progress,
              error: state.render.error,
              stopped: state.render.stopped,
            },
            problem: state.problem,
          };
        }
        return { piece, platform, other, video };
      }),
  );

  const steps = await studioProgress(db, lang, view);
  const canAdd = ready && available.length > 0;
  const addForm = (
          <ActionForm action={createPiecesAction} className="rounded-xl bg-paper p-5 md:p-6">
            <input type="hidden" name="ideaId" value={id} />
            <input type="hidden" name="ui" value={lang} />
            <fieldset>
              <legend className="font-display text-lg font-semibold">{t.choosePlatforms}</legend>
              {scenario?.channels?.length ? (
                <>
                  <p className="mt-1 text-sm text-ink-soft">{t.channelAdviceHint}</p>
                  <div className="mt-3 grid gap-2">
                    {channelOrder(scenario.channels)
                      .filter((platform) => available.includes(platform))
                      .map((platform) => {
                        const pick = scenario.channels?.find((item) => item.platform === platform);
                        return (
                          <label
                            key={platform}
                            className={`flex items-start gap-3 rounded-lg border p-3 ${pick?.recommended ? "border-cobalt" : "border-mist"}`}
                          >
                            <input
                              type="checkbox"
                              name="platforms"
                              value={platform}
                              defaultChecked={pick?.recommended ?? false}
                              className="mt-1 size-4 shrink-0 accent-cobalt"
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2 font-medium">
                                {platformLabel(platform, lang)}
                                {pick && (
                                  <span className="label" aria-label={t.channelFit.replace("{score}", String(pick.score))}>
                                    {"●".repeat(pick.score)}
                                    <span className="opacity-30">{"●".repeat(5 - pick.score)}</span>
                                  </span>
                                )}
                                {pick?.recommended && (
                                  <span className="rounded-full bg-cobalt/20 px-2 py-0.5 text-xs font-semibold text-periwinkle">
                                    {t.channelRecommended}
                                  </span>
                                )}
                              </span>
                              {pick?.angle && (
                                <span className="mt-0.5 block text-sm text-ink-soft" lang={language} dir={textDirection(language)}>
                                  {pick.angle}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </>
              ) : [
                { label: t.groupPosts, hint: null, platforms: TEXT_PLATFORMS as readonly Platform[] },
                { label: t.groupVideos, hint: t.groupVideosHint, platforms: VIDEO_PLATFORMS as readonly Platform[] },
              ].map((group) => {
                const offered = available.filter((platform) => group.platforms.includes(platform));
                if (offered.length === 0) return null;
                return (
                  <div key={group.label} className="mt-3">
                    <p className="label">{group.label}</p>
                    {group.hint && <p className="mt-0.5 text-sm text-ink-soft">{group.hint}</p>}
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {offered.map((platform) => (
                        <label key={platform} className="flex items-center gap-2 rounded-lg border border-mist p-3 font-medium">
                          <input
                            type="checkbox"
                            name="platforms"
                            value={platform}
                            defaultChecked={!isVideoPlatform(platform)}
                            className="size-4 accent-cobalt"
                          />
                          {platformLabel(platform, lang)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </fieldset>
            <fieldset className="mt-5">
              <legend className="font-display text-lg font-semibold">{t.chooseLanguages}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {languages.map((code) => {
                  const canWrite = approved.includes(code);
                  return (
                    <label
                      key={code}
                      className={`flex items-center gap-2 rounded-lg border border-mist p-3 font-medium ${canWrite ? "" : "text-ink-soft opacity-70"}`}
                    >
                      <input
                        type="checkbox"
                        name="languages"
                        value={code}
                        defaultChecked={code === defaultLanguage}
                        disabled={!canWrite}
                        className="size-4 accent-cobalt"
                      />
                      <span>
                        {languageName(code, lang)}
                        {!canWrite && <span className="label block">{t.languageNotApproved}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="mt-3 text-sm text-ink-soft">{t.requestCost}</p>
            <div className="mt-3">
              <SubmitButton pendingLabel={t.creatingPieces} className="btn-primary">
                {t.createPieces}
              </SubmitButton>
            </div>
          </ActionForm>
  );
  return (
    <>
      <Stepper steps={steps} here="posts" t={t} />
      <Link href={`/${lang}/ideas/${id}`} className="text-sm font-medium text-cobalt underline-offset-4 hover:underline">
        {t.backToScenario}
      </Link>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-cobalt">{t.showIdeaMap}</summary>
        <IdeaMap db={db} ui={lang} t={t} languages={contentLanguages} view={view} idea={idea} sibling={sibling} here="content" />
      </details>

      <h1 className="mt-6 font-display text-3xl font-semibold">{t.contentTitle}</h1>
      <p className="mt-1 font-medium text-ink-soft" lang={language} dir={textDirection(language)}>
        {idea.title}
      </p>
      <p className="mt-3 max-w-xl text-ink-soft">{t.contentIntro}</p>

      {!ready && pieces.length === 0 && (
        <p role="status" className="mt-6 rounded-lg border-s-4 border-amber bg-paper p-4 text-sm">
          {t.contentNotReady}
        </p>
      )}
      {canAdd && editors.length === 0 && addForm}

      {editors.length > 0 && (
        <PostTabs
          label={t.contentTitle}
          tabs={[
            ...editors.map(({ piece, platform }) => {
              const state = publishState(piece.publication);
              const tone: PostTab["tone"] =
                state === "posted" ? "posted" : schedules.get(piece.id)?.status === "waiting" ? "scheduled" : "draft";
              return { key: platform, label: platformLabel(platform, lang), tone };
            }),
            ...(canAdd ? [{ key: "add", label: t.addChannels, tone: "add" as const }] : []),
          ]}
          panels={[
            ...editors.map(({ piece, platform, other, video }) => {
          const editorPiece = {
            id: piece.id,
            platform,
            version: piece.currentVersion,
            content: piece.current.content,
            state: publishState(piece.publication),
            postedVersion: piece.publication?.version ?? null,
            postUrl: piece.publication?.url ?? null,
            error: piece.publication?.error ?? null,
            scenarioMoved: scenario !== null && scenario.currentVersion !== piece.current.scenarioVersion,
            connected: PUBLISHERS[platform].missingSettings().length === 0,
            otherPosted: other ? publishState(other.publication) === "posted" : null,
            schedule: scheduleView(schedules.get(piece.id)),
            history: piece.versions.map((version) => ({
                    version: version.version,
                    originLabel: origins[version.origin],
            })),
          };
          // The manager's note is about the draft it checked, so it shows only while that version is on screen.
          const verdict = verdicts.get(piece.id);
          const note = verdict && verdict.version === piece.currentVersion && (
            <ManagerNote verdict={verdict} language={lang} t={t} />
          );
          return (
            <div key={`${piece.id}-${piece.currentVersion}`} className="space-y-2">
              {note}
              {video ? (
                <VideoEditor piece={editorPiece} video={video} language={lang} t={t} />
              ) : (
                <PieceEditor
                  language={lang}
                  contentLanguage={language}
                  brand={brandFor(piece.current.content.slug)}
                  sources={idea.sources}
                  t={t}
                  piece={editorPiece}
                />
              )}
              <RemovePiece
                pieceId={piece.id}
                platform={platform}
                state={editorPiece.state}
                canDeleteLive={canDeleteLive(PUBLISHERS[platform], piece.publication)}
                language={lang}
                t={t}
              />
            </div>
          );
            }),
            ...(canAdd ? [addForm] : []),
          ]}
        />
      )}
    </>
  );
}

import { deleteSampleAction, retrySampleAction, saveSampleNoteAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RefreshWhileMeasuring, SampleUpload } from "@/components/editor-samples";
import { listSamples, NOTE_LENGTH } from "@/lib/agents/editor/samples";
import { getDb } from "@/lib/db/client";
import type { SampleMeasures } from "@/lib/db/schema";
import type { Strings } from "@/lib/i18n";
import { languageName, uiLocale, type Language as ContentLanguage, type UiLanguage as Language } from "@/lib/language";
import { isVideoPlatform } from "@/lib/platforms";

/** The Video Editor's samples: videos you like the editing of, what was measured in each, and your notes. */
export async function EditorSamples({ language, speech, t }: { language: Language; speech: ContentLanguage; t: Strings }) {
  const samples = await listSamples(await getDb());
  const measuring = samples.some((sample) => sample.status === "processing" && !sample.stopped);
  const stages: Record<string, string> = { reading: t.sampleReading, shots: t.sampleShots, speech: t.sampleSpeech };

  return (
    <section className="mt-6 rounded-xl bg-paper p-5 md:p-6">
      <RefreshWhileMeasuring active={measuring} />
      <h2 className="font-display text-xl font-semibold">{t.samplesTitle}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">{t.samplesIntro}</p>
      <p className="mt-2 max-w-2xl text-xs text-ink-soft">{t.samplesDisk}</p>

      <div className="mt-4">
        <SampleUpload language={language} speech={speech} t={t} noteLength={NOTE_LENGTH} />
      </div>

      {samples.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{t.noSamples}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {samples.map((sample) => (
            <li key={sample.id} className="rounded-lg border border-mist p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                {sample.status === "ready" ? (
                  <video
                    src={`/api/agents/editor/samples/${sample.id}`}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-64 w-full rounded-lg bg-black"
                  />
                ) : (
                  <div className="hidden md:block" />
                )}
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    <bdi>{sample.originalName}</bdi>
                  </p>
                  <p className="label mt-1">
                    {sample.platform && isVideoPlatform(sample.platform) ? t.sampleNetworks[sample.platform] : t.sampleAnyVideo} ·{" "}
                    {sample.language === "none" ? t.sampleNoSpeech : languageName(sample.language, language)}
                  </p>

                  {sample.status === "processing" && !sample.stopped && (
                    <p className="pending-pulse mt-3 text-sm" aria-live="polite">
                      {stages[sample.stage ?? "reading"] ?? t.sampleReading}
                    </p>
                  )}
                  {(sample.status === "failed" || sample.stopped) && (
                    <div className="mt-3">
                      <p className="text-sm text-danger">{sample.stopped ? t.sampleStopped : sample.error}</p>
                      <ActionForm action={retrySampleAction} className="mt-2">
                        <input type="hidden" name="sampleId" value={sample.id} />
                        <SubmitButton pendingLabel={t.sampleReading}>{t.sampleRetry}</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                  {sample.status === "ready" && sample.measures && <Measures measures={sample.measures} language={language} t={t} />}

                  {/* Keyed by the saved note, not the time, so refreshes while measuring never wipe what you are typing. */}
                  <ActionForm key={sample.note} action={saveSampleNoteAction} className="mt-3 space-y-2">
                    <input type="hidden" name="sampleId" value={sample.id} />
                    <label className="block">
                      <span className="mb-1 block text-xs text-ink-soft">{t.sampleNote}</span>
                      <textarea
                        name="note"
                        rows={2}
                        maxLength={NOTE_LENGTH}
                        defaultValue={sample.note}
                        dir="auto" className="field"
                        placeholder={t.sampleNotePlaceholder}
                      />
                    </label>
                    <SubmitButton pendingLabel={t.savingNote}>{t.saveNote}</SubmitButton>
                  </ActionForm>
                  {!(sample.status === "processing" && !sample.stopped) && (
                    <ActionForm action={deleteSampleAction} className="mt-2">
                      <input type="hidden" name="sampleId" value={sample.id} />
                      <SubmitButton pendingLabel={t.deleting}>{t.deleteLesson}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Measures({ measures: m, language, t }: { measures: SampleMeasures; language: Language; t: Strings }) {
  const n = (value: number) => value.toLocaleString(uiLocale(language), { maximumFractionDigits: 1 });
  const shape = m.height > m.width ? t.measureVertical : m.height < m.width ? t.measureHorizontal : t.measureSquare;
  const facts = [
    `${t.measureLength.replace("{seconds}", n(m.duration))}, ${shape}`,
    t.measureCuts.replace("{count}", n(m.cutsPerMinute)).replace("{seconds}", n(m.averageShot)),
    m.pauses === 0 ? t.measureNoPauses : t.measurePauses.replace("{count}", n(m.pauses)).replace("{seconds}", n(m.longestPause)),
  ];
  if (m.speech) {
    facts.push(t.measureStart.replace("{seconds}", n(m.speech.firstWordAt)), t.measurePace.replace("{count}", n(m.speech.wordsPerMinute)));
  }
  return (
    <div className="mt-3 text-sm">
      <ul className="list-disc space-y-0.5 ps-5">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {m.speech?.opening && (
        <p className="mt-2">
          <span className="label me-2">{t.measureOpening}</span>
          <bdi>{m.speech.opening}</bdi>
        </p>
      )}
    </div>
  );
}

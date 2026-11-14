import Link from "next/link";
import { cancelScheduleAction, saveWeekPlanAction, scheduleWeekAction, schedulePostAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { loadWeek } from "@/lib/calendar";
import type { Strings } from "@/lib/i18n";
import { uiLocale, type UiLanguage } from "@/lib/language";
import { platformLabel, TEXT_PLATFORMS } from "@/lib/platforms";
import type { ReadyPost, Slot } from "@/lib/plan-week";
import { localTimeValue } from "@/lib/schedule";
import { scheduleLabel } from "@/lib/schedule-time";
import { readyPage } from "@/lib/view";

export const dynamic = "force-dynamic";

const MAX_WEEKS_AHEAD = 12;

function dateLabel(date: Date, ui: UiLanguage) {
  const locale = ui === "fa" ? `${uiLocale(ui)}-u-ca-gregory` : uiLocale(ui);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short" }).format(date);
}

/** A date-and-time box with one button, to schedule or move a post. */
function TimeForm({ pieceId, version, at, label, t }: { pieceId: string; version: number; at: Date; label: string; t: Strings }) {
  return (
    <ActionForm action={schedulePostAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pieceId" value={pieceId} />
      <input type="hidden" name="version" value={version} />
      <input type="datetime-local" name="at" defaultValue={localTimeValue(at)} aria-label={t.calendar.time} className="field w-auto py-1 text-sm" dir="ltr" />
      <SubmitButton pendingLabel={t.saving} className="btn-quiet">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

function SlotCard({ slot, ui, t }: { slot: Slot; ui: UiLanguage; t: Strings }) {
  const c = t.calendar;
  const head = (badge: string, tone: string) => (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold">{platformLabel(slot.platform, ui)}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{badge}</span>
    </p>
  );
  if (slot.kind === "empty") {
    return (
      <div className="rounded-lg border border-dashed border-mist p-3" data-slot="empty">
        {head(scheduleLabel(slot.at, ui), "bg-mist text-ink-soft")}
        <p className="mt-1 text-sm text-ink-soft">
          {c.empty}{" "}
          <Link href={`/${ui}`} className="text-cobalt underline underline-offset-2">
            {c.writeMore}
          </Link>
        </p>
      </div>
    );
  }
  const post = slot.post;
  const title = (
    <Link href={`/${ui}/ideas/${post.ideaId}/content`} className="mt-1 block font-medium hover:text-cobalt">
      <bdi>{post.title}</bdi>
    </Link>
  );
  if (slot.kind === "suggested") {
    return (
      <div className="rounded-lg border border-cobalt p-3" data-slot="suggested">
        {head(c.suggested, "bg-cobalt/20 text-periwinkle")}
        {title}
        <div className="mt-2">
          <TimeForm pieceId={post.pieceId} version={slot.post.version} at={slot.at} label={c.schedule} t={t} />
        </div>
      </div>
    );
  }
  const fixed = slot.post;
  return (
    <div className="rounded-lg bg-canvas p-3" data-slot={fixed.state}>
      {head(fixed.state === "posted" ? c.live : `${c.scheduled} · ${scheduleLabel(fixed.at, ui)}`, fixed.state === "posted" ? "bg-mist text-ink" : "bg-amber/20 text-amber-deep")}
      {title}
      {fixed.state === "scheduled" && fixed.version && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TimeForm pieceId={fixed.pieceId} version={fixed.version} at={fixed.at} label={c.move} t={t} />
          <ActionForm action={cancelScheduleAction}>
            <input type="hidden" name="pieceId" value={fixed.pieceId} />
            <SubmitButton pendingLabel={t.saving} className="btn-quiet">
              {c.cancel}
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

/**
 * The weekly calendar: your pattern, the posts that fit it this week, and what's already scheduled
 * or live. Planning is plain code; nothing goes out until you schedule it.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { lang: param } = await params;
  const { week: weekParam } = await searchParams;
  const { ui: lang, t, db, view } = await readyPage(param);
  const c = t.calendar;
  const week = Math.max(0, Math.min(MAX_WEEKS_AHEAD, Math.round(Number(weekParam)) || 0));
  const firstDay = lang === "fa" ? 6 : 1;
  const { plan, days, unplaced } = await loadWeek(db, view, firstDay, week);
  const suggestions = days.reduce((count, day) => count + day.slots.filter((slot) => slot.kind === "suggested").length, 0);
  const today = new Date();
  const weekdays = Array.from({ length: 7 }, (_, offset) => (firstDay + offset) % 7);
  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(uiLocale(lang), { weekday: "long" }).format(new Date(2024, 0, 7 + day));
  const nextUnplaced = (post: ReadyPost) => {
    const [hour, minute] = plan.time.split(":").map(Number);
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, hour, minute);
    return <TimeForm pieceId={post.pieceId} version={post.version} at={at} label={c.schedule} t={t} />;
  };

  return (
    <>
      <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{c.title}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{c.intro}</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href={`/${lang}/calendar?week=${week - 1}`}
          aria-disabled={week === 0}
          className={`btn btn-quiet ${week === 0 ? "pointer-events-none opacity-40" : ""}`}
        >
          {c.previous}
        </Link>
        <Link href={`/${lang}/calendar`} className="btn btn-quiet" aria-current={week === 0 ? "page" : undefined}>
          {c.thisWeek}
        </Link>
        <Link
          href={`/${lang}/calendar?week=${week + 1}`}
          aria-disabled={week === MAX_WEEKS_AHEAD}
          className={`btn btn-quiet ${week === MAX_WEEKS_AHEAD ? "pointer-events-none opacity-40" : ""}`}
        >
          {c.next}
        </Link>
      </div>

      <div className="mt-6 rounded-xl bg-paper p-4 md:p-5">
        {suggestions > 0 ? (
          <ActionForm action={scheduleWeekAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="language" value={view} />
            <input type="hidden" name="firstDay" value={firstDay} />
            <input type="hidden" name="week" value={week} />
            <SubmitButton pendingLabel={c.schedulingAll} className="btn-primary">
              {c.scheduleAll} ({suggestions.toLocaleString(uiLocale(lang))})
            </SubmitButton>
            <p className="min-w-0 flex-1 text-sm text-ink-soft">{c.scheduleAllHint}</p>
          </ActionForm>
        ) : (
          <p className="text-sm text-ink-soft">{c.noSuggestions}</p>
        )}
      </div>

      <ol className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-calendar>
        {days.map((day) => {
          const isToday = day.date.toDateString() === today.toDateString();
          return (
            <li key={day.date.toISOString()} className={`rounded-xl border p-4 ${isToday ? "border-cobalt" : "border-mist"} ${day.past ? "opacity-60" : ""}`}>
              <h2 className="flex items-baseline justify-between gap-2 font-display text-lg font-semibold">
                <span>{dateLabel(day.date, lang)}</span>
                {isToday && <span className="label">{c.today}</span>}
              </h2>
              <div className="mt-3 space-y-2">
                {day.slots.length === 0 ? (
                  <p className="text-sm text-ink-soft">{c.restDay}</p>
                ) : (
                  day.slots.map((slot, index) => <SlotCard key={`${slot.platform}-${index}`} slot={slot} ui={lang} t={t} />)
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {unplaced.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold">{c.unplacedTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{c.unplacedHint}</p>
          <ul className="mt-4 space-y-2">
            {unplaced.map((post) => (
              <li key={post.pieceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-paper p-3">
                <span className="min-w-0">
                  <span className="label block">{platformLabel(post.platform, lang)}</span>
                  <Link href={`/${lang}/ideas/${post.ideaId}/content`} className="font-medium hover:text-cobalt">
                    <bdi>{post.title}</bdi>
                  </Link>
                </span>
                {nextUnplaced(post)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="mt-10 rounded-xl border border-mist p-4 md:p-5">
        <summary className="cursor-pointer font-semibold">{c.patternTitle}</summary>
        <p className="mt-1 text-sm text-ink-soft">{c.patternHint}</p>
        <ActionForm key={JSON.stringify(plan)} action={saveWeekPlanAction} className="mt-4 space-y-4">
          <div className="space-y-2">
            {weekdays.map((day) => (
              <fieldset key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-mist pb-2">
                <legend className="sr-only">{weekdayName(day)}</legend>
                <span aria-hidden className="w-28 font-medium">
                  {weekdayName(day)}
                </span>
                {TEXT_PLATFORMS.map((platform) => (
                  <label key={platform} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name={`day:${day}`}
                      value={platform}
                      defaultChecked={plan.days[day].includes(platform)}
                      className="size-4 accent-cobalt"
                    />
                    {platformLabel(platform, lang)}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{c.time}</span>
              <input type="time" name="time" defaultValue={plan.time} className="field w-auto" dir="ltr" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{c.gap}</span>
              <input type="number" name="gapDays" min={0} max={14} defaultValue={plan.gapDays} className="field w-24" dir="ltr" />
            </label>
          </div>
          <SubmitButton pendingLabel={t.saving} className="btn-primary">
            {c.savePattern}
          </SubmitButton>
        </ActionForm>
      </details>
    </>
  );
}

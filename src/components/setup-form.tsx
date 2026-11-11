"use client";

import { useState } from "react";
import { saveProfileAction } from "@/app/actions";
import type { Strings } from "@/lib/i18n";
import { CONTENT_LANGUAGES, languageName, type Language, type UiLanguage } from "@/lib/language";
import { DEFAULT_BLOG_PATH, DEFAULT_COLORS, type BrandColors, type Profile } from "@/lib/profile";
import { ActionForm, SubmitButton } from "./action-form";

const HANDLES = ["instagram", "youtube", "linkedin", "telegram"] as const;
const COLORS: (keyof BrandColors)[] = ["primary", "dark", "light", "highlight"];

function Text({
  name,
  label,
  hint,
  defaultValue,
  dir,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  dir?: "ltr" | "rtl";
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-semibold">{label}</span>
      {hint && <span className="block text-sm text-ink-soft">{hint}</span>}
      <input name={name} defaultValue={defaultValue} dir={dir} placeholder={placeholder} className="field mt-1" />
    </label>
  );
}

/** Setup. The fields for each language follow the languages chosen, so they appear as soon as one is picked. */
export function SetupForm({ profile, ui, t }: { profile: Profile | null; ui: UiLanguage; t: Strings }) {
  const [main, setMain] = useState<Language>(profile?.languages[0] ?? ui);
  const [second, setSecond] = useState<Language>(profile?.languages[1] ?? "");
  const chosen = [main, second].filter(Boolean);
  const colors = profile?.colors ?? DEFAULT_COLORS;
  const options = [...CONTENT_LANGUAGES].sort((a, b) => languageName(a.code, ui).localeCompare(languageName(b.code, ui), ui));
  const label = (code: Language) => {
    const info = CONTENT_LANGUAGES.find((item) => item.code === code)!;
    const name = languageName(code, ui);
    return name === info.native ? name : `${name} · ${info.native}`;
  };

  return (
    <ActionForm action={saveProfileAction} className="mt-8 space-y-10">
      <input type="hidden" name="ui" value={ui} />
      <input type="hidden" name="first" value={profile ? "no" : "yes"} />

      <section className="space-y-5">
        <Text name="name" label={t.setupName} hint={t.setupNameHint} defaultValue={profile?.name ?? ""} dir="ltr" />
        <fieldset className="space-y-3">
          <legend className="font-semibold">{t.setupLanguages}</legend>
          <p className="text-sm text-ink-soft">{t.setupLanguagesHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">{t.setupMainLanguage}</span>
              <select
                name="main"
                value={main}
                onChange={(event) => {
                  setMain(event.target.value);
                  if (event.target.value === second) setSecond("");
                }}
                dir="auto" className="field mt-1"
              >
                {options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {label(option.code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{t.setupSecondLanguage}</span>
              <select name="second" value={second} onChange={(event) => setSecond(event.target.value)} dir="auto" className="field mt-1">
                <option value="">{t.setupNoSecond}</option>
                {options
                  .filter((option) => option.code !== main)
                  .map((option) => (
                    <option key={option.code} value={option.code}>
                      {label(option.code)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {profile && <p className="text-sm text-ink-soft">{t.setupLanguagesLater}</p>}
        </fieldset>

        {chosen.map((code) => {
          const info = CONTENT_LANGUAGES.find((item) => item.code === code)!;
          return (
            <fieldset key={code} className="space-y-3 rounded-xl bg-paper p-5">
              <legend className="sr-only">{t.setupPerLanguage.replace("{name}", languageName(code, ui))}</legend>
              <p className="font-display text-lg">{t.setupPerLanguage.replace("{name}", languageName(code, ui))}</p>
              <Text
                name={`headline:${code}`}
                label={t.setupHeadline}
                hint={t.setupHeadlineHint}
                defaultValue={profile?.headlines[code] ?? ""}
                dir={info.dir}
              />
              {code !== "en" && (
                <Text name={`localName:${code}`} label={t.setupLocalName} defaultValue={profile?.localNames[code] ?? ""} dir={info.dir} />
              )}
            </fieldset>
          );
        })}
      </section>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl">{t.setupAccounts}</legend>
        <p className="text-sm text-ink-soft">{t.setupAccountsHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {HANDLES.map((handle) => (
            <Text
              key={handle}
              name={handle}
              label={{ instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", telegram: "Telegram" }[handle]}
              defaultValue={profile?.handles[handle] ?? ""}
              dir="ltr"
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl">{t.setupWebsite}</legend>
        <Text
          name="websiteUrl"
          label={t.setupWebsiteUrl}
          hint={t.setupWebsiteUrlHint}
          defaultValue={profile?.websiteUrl ?? ""}
          dir="ltr"
          placeholder="https://example.com"
        />
        <Text
          name="blogPath"
          label={t.setupBlogPath}
          hint={t.setupBlogPathHint}
          defaultValue={profile?.blogPath ?? DEFAULT_BLOG_PATH}
          dir="ltr"
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl">{t.setupLook}</legend>
        <p className="text-sm text-ink-soft">{t.setupLookHint}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map((key) => (
            <label key={key} className="block">
              <span className="label">
                {{ primary: t.colorPrimary, dark: t.colorDark, light: t.colorLight, highlight: t.colorHighlight }[key]}
              </span>
              <input type="color" name={key} defaultValue={colors[key]} className="mt-1 h-11 w-full cursor-pointer rounded-[5px] border border-mist bg-canvas p-1" />
            </label>
          ))}
        </div>
        <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
          <legend className="label mb-1">{t.headingStyle}</legend>
          {(["serif", "sans"] as const).map((style) => (
            <label key={style} className="flex items-center gap-2">
              <input
                type="radio"
                name="headingStyle"
                value={style}
                defaultChecked={(profile?.headingStyle ?? "serif") === style}
                className="accent-cobalt"
              />
              {style === "serif" ? t.headingSerif : t.headingSans}
            </label>
          ))}
        </fieldset>
      </fieldset>

      <SubmitButton pendingLabel={t.savingProfile} className="btn-primary">
        {t.saveProfile}
      </SubmitButton>
    </ActionForm>
  );
}

# Content Production Studio

A personal-brand content production studio that runs on your own computer. It finds timely ideas in this week's news, writes them in your voice, and turns each approved idea into a different post for every network: a Telegram note, a LinkedIn post, an Instagram carousel, a blog article, and scripts for videos you film yourself, which it then edits.

Nothing is published without your click, and every approval is tied to the exact version you saw.

- **Your brand, your voice.** On the Setup page you add your name, languages, accounts, website and colours. A Brand Kit per language (positioning, audience, pillars, voice guide, samples) shapes every prompt.
- **One or two languages.** Write in any one of 15 languages, or a pair. With two, every idea and post is written in the main language first, then adapted into the second, as a native writer would phrase it rather than as a word-for-word translation.
- **An AI team.** Nine writers, each with one job, plus a manager that checks first drafts and a coach that turns your edits and decisions into lessons. You can give each member its own instructions.
- **Posting.** Telegram, LinkedIn, Instagram and your website, through their official APIs, or by hand (copy, download, then record that you posted) wherever a connection isn't set up.
- **Video.** Upload the clip you filmed. The studio transcribes it on your computer with Whisper, proposes an edit (cuts, captions, title card, zooms, chapters), and renders it with FFmpeg in your brand's fonts and colours.
- **Free while you try it.** It uses OpenRouter's free models by default, and Claude when you add an Anthropic key.

> **Security:** there is no login. The studio only listens on `127.0.0.1`, so only your own computer can open it. Anyone who can open it can post as you, so **add authentication before hosting it anywhere else.**

## Requirements

- Node.js 20 or newer
- Google Chrome, to draw slide images and video cards
- FFmpeg, for video only (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Linux: your package manager)
- About 2 GB of free disk space for video work. The speech model (about 1.1 GB) downloads with your first clip.

## Quick start

```bash
git clone <this repository>
cd content-studio
npm install
cp .env.example .env.local   # then add OPENROUTER_API_KEY and TAVILY_API_KEY
npm run dev
```

Open http://127.0.0.1:3000. The studio starts on **Setup**:

1. Your name and one or two content languages.
2. For each language: one line on what you do, and your name if it's written differently (for example in another alphabet).
3. Optionally, your account names, your website, and colours for slides and videos.

Next, fill in the **Brand Kit** for each language. Ideas follow it closely, so the more real writing samples you paste, the more the studio sounds like you.

Keys: [OpenRouter](https://openrouter.ai/keys) (free models) or an Anthropic key, plus [Tavily](https://app.tavily.com) for news search. Every other setting is optional and explained in `.env.example`.

## Languages

The interface is in English or Farsi. Content can be written in English, Farsi, Arabic, Spanish, French, German, Italian, Portuguese, Dutch, Swedish, Polish, Turkish, Indonesian, Russian or Ukrainian. Right-to-left languages, captions and slides work out of the box.

The list is limited to scripts the bundled fonts can draw (Inter for Latin and Cyrillic, Vazirmatn for Arabic script). To add a language, add an entry to `CONTENT_LANGUAGES` in `src/lib/language.ts` with its direction, script and the three short phrases the studio prints on slides and end cards.

When you have two languages, a **Content language** switch appears in the side menu.

## Connections

The **Connections** page shows what is set up, and explains what each missing setting is for. It only checks access and never posts.

| Network | What it needs | Without it |
| --- | --- | --- |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` (the bot must be an admin of the channel) | Not available |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN` | Copy the text, post it yourself, and record it |
| Instagram | `INSTAGRAM_ACCESS_TOKEN` (Business or Creator account), plus `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for public image links | Download the slides, post them yourself, and record it |
| Website | A webhook, or a Supabase table (below) | Not available |
| Videos | Always posted by hand for now | Download the video and thumbnail |

### Posting to your website

Choose one of two ways.

**A. Webhook.** Set `WEBSITE_WEBHOOK_URL` (and optionally `WEBSITE_WEBHOOK_SECRET`). The studio sends a `POST` with this JSON body:

```json
{
  "event": "article.publish",
  "id": "piece-id-v3",
  "language": "en",
  "slug": "why-small-bakeries-should-automate-orders",
  "title": "…",
  "excerpt": "…",
  "body_markdown": "…",
  "tags": ["automation"],
  "url": "https://example.com/en/blog/why-small-bakeries-should-automate-orders",
  "published_at": "2026-11-10T09:00:00.000Z"
}
```

Headers: `Content-Type: application/json`, `Idempotency-Key: <id>` (the same on a retry, so you can avoid publishing twice), and `Authorization: Bearer <WEBSITE_WEBHOOK_SECRET>` when a secret is set.

Answer with any `2xx` status. You may return `{ "id": "…", "url": "…" }` to tell the studio where the article went. Answer `409` if the slug is already taken, `401` or `403` if the secret is wrong. Any `5xx` or a dropped connection is treated as "may have posted", and the studio asks you to check before sending it again. This works with n8n, Zapier, Make, a WordPress or Ghost endpoint, or your own site.

**B. Supabase.** Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Each article becomes one row per language in `blog_posts`, or in the table named in `WEBSITE_SUPABASE_TABLE`:

```sql
create table blog_posts (
  id uuid primary key default gen_random_uuid(),
  locale text not null,
  slug text not null,
  title text not null,
  excerpt text not null default '',
  body_md text not null,
  tags text[] not null default '{}',
  status text not null default 'draft',
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (locale, slug)
);
```

In both cases, the article's address comes from your website and the "Where an article lives" pattern on the Setup page, for example `/{lang}/blog/{slug}`.

## The AI team

Each member has one job and its own lessons (see the **Team** page): Idea Scout, Scenario Writer, Language Writer (only with two languages), Telegram Writer, LinkedIn Writer, Carousel Designer, Blog Writer, Video Scriptwriter and Video Editor.

- **Instructions:** each member has its own page with your standing instructions: one box for all your work, and with two languages one box for each language. Only that member reads them.
- **Manager:** scores each first draft from 1 to 10 and sends anything under 7 back once, with reasons. It can be paused to save AI requests.
- **Learning Coach:** after 6 new pieces of feedback (your edits, change requests, rejections and approvals, and the manager's findings), or when you click "Learn now", the coach rewrites that member's lessons. Lessons you add yourself are never changed.
- **Results:** a few days after a post goes live, add its numbers on the **Results** page. Each post is compared only with your other posts on the same network, and the scout and writers learn from what worked.
- **Video Editor samples:** upload videos whose editing you like. The studio measures their pace on your computer, and the editor uses those numbers and your notes when planning an edit.

## Your data

Everything stays in `.data/` on your computer: the database, your clips, finished videos and the speech model. The AI provider sees only the text it is asked to write or check. Slide images go to your Supabase storage only when you post to Instagram.

To use a hosted Postgres instead of the local database, set `DATABASE_URL`. In production (`npm run build && npm start`), `DATABASE_URL` is required.

## Development

```bash
npm test          # workflow rules against an in-memory database, with fake AI and search (no credits)
npm run typecheck
```

Where things are:

- `src/lib/profile.ts`: who the studio works for (Setup)
- `src/lib/language.ts`: interface and content languages
- `src/lib/studio.ts`: ideas, scenarios, approval and versions
- `src/lib/content.ts`: platform posts, and the approve-and-post rules that prevent double posting
- `src/lib/ai/writer.ts`: every prompt. `{OWNER}` is replaced with your name
- `src/lib/agents/`: the team roster, manager checks, feedback, lessons and the coach
- `src/lib/publishers/`: one connector per network
- `src/lib/slides.ts`, `src/lib/video/overlays.ts`, `src/lib/brand-style.ts`: slide, video card and thumbnail templates
- `src/lib/video/`: transcription, edit plans and rendering
- `src/lib/i18n.ts`: interface text in English and Farsi

## License

[MIT](LICENSE). The bundled fonts in `assets/fonts` (Inter and Vazirmatn) are under the [SIL Open Font License 1.1](assets/fonts/OFL.txt).

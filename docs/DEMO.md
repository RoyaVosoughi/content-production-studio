# Demo script

A click-by-click walk through the studio in about 8 minutes, using sample data so every page is full.
The sample creator, **Sara Rahimi**, is made up: she helps small cafés and bakeries with marketing, in
English and Farsi. Every name, number and link in the sample data is invented, and the links go to example.com.

## Before you present

1. **Start the demo fresh, the day you present:**
   ```bash
   npm run demo -- --fresh
   ```
   The dates are counted back from the moment the demo is filled, so starting it fresh makes "last week"
   and "next week" line up with the real calendar. Then open http://127.0.0.1:3002.
   - The demo has its own database in `.data/demo`. Your own studio's data in `.data` is never touched.
   - If your own studio is already running on 3002, use `npm run demo -- --fresh --port 3003` instead.
     The two can run side by side.
2. **Open each page once** (Results, the weekly report, Calendar, Agents) so the first click during the
   demo doesn't wait for the page to compile.
3. **Check the keys** on Connectors: a Gemini or OpenRouter key and a Tavily key, for the live idea search
   in step 2. Everything else in the demo works without the internet.
4. **Optional, for the video step:** open the idea "The rainy-day post that fills a quiet café", go to its
   **Instagram Reel** (Farsi), and upload a 1 to 2 minute clip **at least 10 minutes before** you present.
   Transcription takes about 50 seconds per minute of video, so it must be ready before you start.
5. Close other tabs, set the browser zoom to 110%, and turn on Do Not Disturb.

## The story to tell

> "A creator who runs a small business has no time for content. This studio finds the week's ideas, writes
> each one for every network in her voice and in two languages, checks it before it goes out, and then
> learns from the numbers what to make next week. Nothing goes out without her click."

## Step by step

### 1. Brand Kit (30 seconds)

Click **Brand Kit**.

- Point at the positioning, audience, three pillars and the voice guide.
- Say: *"Everything the team writes follows this page. It's set up once, per language."*
- Switch the content language to Farsi in the side menu to show the second kit, then back to English.

### 2. Find ideas, live (1 minute)

Click **Studio**.

- Type a topic, for example `holiday season for small bakeries`, and click **Find ideas on this topic**.
- While it searches (20 to 40 seconds), say: *"The Idea Scout reads this week's news, my own sources, and
  what worked in my past posts."*
- When the ideas appear, point at the **why now** line and the sources under each one.
- If the search is slow or the internet fails, skip ahead: three ideas from this morning's search are
  already waiting on the same page.

### 3. An idea's scenario (1 minute)

Under **Approved ideas**, open **Partner with the shop next door**.

- Its scenario is written and waiting for approval. Show the main points, the example and the call to action.
- Show the channel advice: which networks fit this idea, with a score and a brief for each.
- Click **Approve this version**. Say: *"Every approval is tied to the exact version I saw."*

### 4. One idea, every network, two languages (1.5 minutes)

Open **The rainy-day post that fills a quiet café**, then its posts.

- Click through the tabs: LinkedIn, Instagram carousel, Website, YouTube Short. Each is written for its
  network, not copied.
- On LinkedIn, show the **three hooks** (story, question, bold claim) and pick a different one. The post's
  first line changes. Say: *"The studio counts which kind of opening I pick, and which kind does well."*
- Show the **ready check**: type a number without a source, or a very long line, and watch it flag the post
  instantly. It costs nothing, it runs in code.
- On Instagram, show the slides in the brand's colours, and the manager's note: the first draft's cover was
  too long, so it was sent back and rewritten before Sara ever saw it.
- Switch the content language to Farsi: the Telegram post and the Reel script are written in Farsi as a
  native writer would, not translated word for word.

### 5. Calendar (45 seconds)

Click **Calendar**, then **Next week**.

- Monday's LinkedIn post is already **scheduled**.
- A ready post is **suggested** for an open slot. The other open slots say what's missing.
- Say: *"The calendar is worked out by code from my weekly pattern. It keeps one idea's posts a few days apart."*
- Optionally click **Schedule all suggestions**.

### 6. What worked (1.5 minutes)

Click **Analysis**.

- **Live posts with numbers**: every post is compared only with Sara's other posts on the same network,
  because a Telegram view and a YouTube view aren't worth the same.
- **By content pillar**: café stories do best, pricing posts do worst.
- **Hooks that work**: story openings beat bold claims.
- Point at Sara's note on the best LinkedIn post ("Three café owners messaged me...").

### 7. The weekly report (1 minute)

Click **Open the weekly report**, then **Earlier week**.

- What went out, what worked, topics and hooks of that week.
- **What to make next week**: follow up the best post, more café stories, open with a story, go easy on
  pricing, schedule the ready post, and the open slots with the approved ideas to fill them.
- Say: *"Every line is backed by the numbers. One lucky post never becomes a rule."*
- **Print or save as PDF** turns it into a one-page report.

### 8. The team learns (45 seconds)

Click **Agents**, then open **LinkedIn Writer**.

- Show the coach's lesson: *"Open with a moment from a real café before any advice..."*, learned from
  Sara's hook picks and her results.
- Back on Agents, open **Idea Scout**: its lesson about pricing ideas came from two weak posts.
- Close with: *"The more I post, the better the team gets at sounding like me and making what works."*

### 9. Video (optional, 1 minute)

Only if you uploaded a clip beforehand (see "Before you present").

- Open the Reel with the clip: show the proposed edit (cuts, captions, title card, zooms, explainer
  animations) and the finished video.
- Or click **Video** in the menu to animate a short script as cartoons or motion graphics.

## If something goes wrong

- **A page is slow the first time:** that's the page compiling; it's fast afterwards. Open every page once
  before you present.
- **The idea search fails:** the AI or the news search is offline. Use the three ideas already waiting.
- **The data looks out of date:** stop the studio (Ctrl+C) and run `npm run demo -- --fresh`.
- **"Another next dev server is already running":** your own studio is using the folder's normal build.
  The demo uses its own, so this only appears when another demo is still running. Close it first.

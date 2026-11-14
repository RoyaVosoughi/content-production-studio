# Prompt of edits

The video editor agent reads this file every time it plans an edit.

How it is used:

- Prompts marked `Use when: always` go into every edit plan.
- Every other prompt goes in only when one of its keywords appears in what you asked for: the "What should this edit do?" box on the plan step, or the editor's instructions on the Agents page.
- `Studio: yes` means the studio does this itself. `Studio: partly` means it does some of it. `Studio: no` means it needs another tool. The editor then names the prompt in its reason so you can copy it from here.

To add a prompt, copy one block. Start it with `## id · Title`, give it the four lines, then write the prompt. Ids use lowercase letters and dashes.

---

## silence-cuts · Cut only in silence
- Use when: always
- Studio: yes
- Keywords: cut, trim, filler, mistake, repeat, برش, کوتاه, اشتباه, تکرار
- Source: SuperDuperAI library (Scenes, not best phrases; trim filler)

Cut only where the join falls in silence, never in the middle of a word or a sentence. Trim filler words (um, uh, so, like, یعنی، خب، ببینید) at the end of a line. When a line is said more than once, keep the last complete take. Keep a point whole: its lead-in, the point itself and its ending. Don't cut the line that sets up the next one.

## hook-first · Hook in the first 3 seconds
- Use when: always
- Studio: yes
- Keywords: hook, opening, intro, start, قلاب, شروع, ابتدا, مقدمه
- Source: SuperDuperAI library (Hook text on screen, Cold open)

The first 3 seconds decide whether people stay. Cut any slow start: greetings, "so today I want to talk about", clearing the throat. Open on the strongest line. The title card is the hook on screen: at most 6 words that make a promise or raise a question the video answers. It must match what is said at that moment.

## read-as-text · Read the cut as text before deciding
- Use when: always
- Studio: yes
- Keywords: review, check, بازبینی, بررسی
- Source: SuperDuperAI library (Read the film as text, Critic pass)

Before you answer, read the phrases you keep, in order, as if they were the script. Check them in two passes. First, structure: does it still make sense, is anything repeated, does the pace drag anywhere? Second, the joins: does any kept phrase start or end mid-thought, or depend on a phrase you cut?

## length-follows · Let length follow the material
- Use when: always
- Studio: yes
- Keywords: length, duration, long, short, طول, مدت, کوتاه‌تر, بلند
- Source: SuperDuperAI library (Length follows the material)

Don't pad a clip to reach a target length, and don't cut good material only to be shorter. Cut what is weak, repeated or slow. If the clip is still longer than the network allows, cut the least important points, never the call to action.

## keep-original · Keep the original voice, light and colour
- Use when: always
- Studio: yes
- Keywords: audio, voice, sound, color, colour, lighting, صدا, رنگ, نور
- Source: Reels editor prompt

Don't change the voice, the audio, the lighting or the colours. The original audio stays as it is. Keep the framing close to the original and don't zoom in much on the face: zooms are a slight push-in only.

## captions-readable · Captions people can read
- Use when: caption, subtitle, text, reading, highlight
- Studio: partly (the studio draws captions and highlights; position and size are fixed)
- Keywords: caption, subtitle, srt, text on screen, reading, highlight, readable, زیرنویس, کپشن, متن, خوانا, هایلایت
- Source: SuperDuperAI library (Reading speed, Accessible on-screen text, Burned subtitles for 9:16)

Highlight only the words that carry the point: a number, a result, the key term. Don't highlight filler or every noun. Callouts stay up long enough to read: no more than 4 words, about 1 second for every 3 words. Use strong contrast, no flashing text, and nothing at the very top or bottom of a vertical video.

## safe-zones · Keep text inside the safe zones
- Use when: vertical, reel, short, safe zone, layout
- Studio: partly (studio captions already sit inside the safe area)
- Keywords: safe zone, safe area, vertical, 9:16, reel, short, buttons, layout, ناحیه امن, عمودی, ریلز, شورت, چیدمان
- Source: Reels editor prompt, SuperDuperAI library

On Reels and Shorts, the top 15% of the frame holds the app's top bar, the bottom 25% holds the caption and buttons, and the right edge holds the like and share buttons. Keep every text and key visual out of those areas. Keep title cards and callouts short so they fit the centre.

## caption-glossary · Fix names and terms in captions
- Use when: spelling, names, terms, glossary
- Studio: partly (you fix caption words by hand in the phrase list)
- Keywords: spelling, misspell, name, term, glossary, typo, املا, غلط, اسم, اصطلاح, واژه
- Source: SuperDuperAI library (SRT cleanup)

Speech-to-text turns names and tech terms into wrong words. The script is the glossary: when a transcript word looks like a misheard name or term from the script, say so in your reason ("phrase 4 says X, the script says Y; fix it in the phrase list"). Still copy highlights exactly as they appear in the transcript.

## step-callouts · Make every step big and clear
- Use when: steps, process, list, tutorial
- Studio: yes (callouts)
- Keywords: step, process, list, tutorial, how to, first, second, مرحله, گام, قدم, آموزش, فرآیند, لیست
- Source: Reels editor prompt

When the video explains a step-by-step process, give each step its own callout at the moment it is said: "Step 1", "Step 2", or the step's name in 1 to 4 words. Use a slight zoom on the step that matters most. Don't put callouts on anything else in that video, so the steps stand out.

## youtube-chapters · Chapters from the transcript
- Use when: youtube, chapters
- Studio: yes (long YouTube videos only)
- Keywords: chapter, youtube, section, فصل, یوتیوب, بخش
- Source: SuperDuperAI library (Transcript to YouTube chapters)

Start a chapter wherever a new point begins, the first one at the first kept phrase. Each chapter is at least 10 seconds long. Titles are 2 to 5 words, say what the viewer gets ("Why prompts fail"), and are not numbered.

## animated-explainer-reel · Animated explainer Reel (picture-in-picture + full-screen animation)
- Use when: animation, explainer, picture in picture
- Studio: partly. "Animate a script" on the Video studio page makes the full-screen explainer scenes; picture-in-picture over your clip still needs another tool
- Keywords: animation, animated, explainer, picture in picture, pop-up, split screen, full screen, motion graphics, glass, grid, انیمیشن, متحرک, توضیحی, تصویر در تصویر, تمام صفحه, موشن گرافیک
- Source: Reels editor prompt

I've attached two videos:
MAIN VIDEO: my raw talking-head recording that needs to be edited.
SAMPLE VIDEO: a reference for editing style, pacing and layout. Take inspiration from it; don't copy it.

# GOAL
Edit my main video into a polished, modern educational video for [Instagram Reels, 9:16, 1080x1920].

# SETUP
First, check which tools are installed on my computer, and install anything missing that you need: ffmpeg, Python with faster-whisper for transcription, and Node.js with Puppeteer for rendering animations.
Transcribe my voice with word-level timestamps. The video is in [Persian], and I don't read a script word for word, so sync every animation to the exact moment I say the related word.

# LAYOUT
Mix two modes, like the sample:
a) My video appears as a pop-up / picture-in-picture card, while the animation explaining my point fills the main area.
b) Some moments are full-screen animation only, with just my voice playing.
Transition smoothly between the two modes.
Don't zoom in too much on my face. Keep my framing similar to the sample.
Keep all text and key visuals inside the platform's safe zones, so nothing hides behind the app's buttons, captions or top bar.

# VISUAL STYLE
White / light background with a modern tech look: subtle grid, glass cards, soft shadows, thin precise lines, glowing accents.
Technology-based animations that feel professional and serious. NOT cartoonish, childish or basic.
Use your own color palette (blue, violet, cyan accents work well).
Use smooth, high-quality motion: eased transitions, elements revealed in sync with my words, small animated details.
For step-by-step processes, make each step BIG and unmistakably clear.
If text is in Persian, use a proper Persian font (e.g. Vazirmatn) so letters connect correctly.

# AUDIO & IMAGE
Do not change my voice, audio, lighting or colors. Keep the original audio as is.

# QUALITY CHECK
Before the full render, render still frames at key moments, review them yourself, and fix overlaps, clipped text or timing issues.
Show me a storyboard (scene list with timestamps and split/full-screen choice) before building, so I can approve it.
Final output: an MP4 at the format above, saved next to my original video.

---

The prompts below are for AI image and video tools (such as Runway, Kling or Veo). They change what is in the picture, which the studio can't do, and those tools upload your footage to their servers. Several go against "keep the original light and colour", so use them only when you ask for that change yourself.

## cinematic-upgrade · Cinematic look and premium quality (تغییر سینمایی و کیفیت فوق‌العاده)
- Use when: cinematic, premium
- Studio: no (needs an AI video tool)
- Keywords: cinematic, premium, commercial, film look, golden hour, depth of field, سینمایی, حرفه‌ای, تبلیغاتی, عمق میدان
- Source: AI video and image prompt book

Transform this uploaded video into a premium, professional-looking cinematic clip. Keep [PERSON/MAIN_SUBJECT] and their original appearance consistent while preserving the original actions. Enhance the overall visual quality, color grading, contrast, and depth of field. Change the lighting to [golden hour/moody studio], add subtle background blur, natural cinematic camera movement, and subtle motion blur. Make the final result feel like a high-budget [fashion/travel] commercial rather than an obviously AI-generated video.

## enhance-quality · Enhance image quality (ارتقای کیفیت عکس)
- Use when: enhance, sharpen
- Studio: no (needs an AI image tool; useful for a thumbnail or cover photo)
- Keywords: enhance, sharpen, sharper, clarity, quality, blurry, thumbnail, cover, کیفیت, شفاف, واضح, تار, کاور, تامبنیل
- Source: AI video and image prompt book

Enhance this image so it looks sharper, cleaner, clearer, and more professional while preserving the original composition and content. Improve fine detail, lighting, exposure, color accuracy, contrast, sharpness, and overall clarity without making it look artificial.

## color-grading · Professional colour grading (اصلاح رنگ حرفه‌ای)
- Use when: color grade
- Studio: no (needs an AI image or video tool)
- Keywords: color grade, colour grade, color grading, grading, color correction, اصلاح رنگ, رنگ‌بندی, تصحیح رنگ
- Source: AI video and image prompt book

Apply a professional cinematic color grade to this image while keeping skin tones natural and the subject unchanged. Balance highlights and shadows, refine contrast and saturation, and give the entire image a consistent, polished finish.

## background-swap · Replace the background or location (تعویض پس‌زمینه / لوکیشن)
- Use when: background, location
- Studio: no (needs an AI video tool)
- Keywords: background, backdrop, location, replace background, پس‌زمینه, پس زمینه, لوکیشن, بک‌گراند, بکگراند
- Source: AI video and image prompt book

Replace the current background with [NEW_BACKGROUND]. Keep the main subject's face, body, clothing, movement, and proportions unchanged. Match the new environment's lighting, perspective, shadows, and reflections so the edit looks completely realistic.

## day-to-night · Turn day into night (تبدیل روز به شب)
- Use when: night
- Studio: no (needs an AI video tool)
- Keywords: night, day to night, neon, blue hour, شب, روز به شب, نئون
- Source: AI video and image prompt book

Convert this daytime video into a realistic [cinematic night/neon night/blue-hour] scene. Keep all people, buildings, objects, and movements unchanged. Darken the sky naturally, introduce realistic [streetlights/window lights/neon signs], add appropriate reflections and shadows, and adjust subject lighting to match.

## outpainting · Expand the image beyond its borders (گسترش دادن عکس)
- Use when: expand, aspect ratio
- Studio: no (needs an AI image tool; useful to turn horizontal footage or a photo into 9:16 without cropping)
- Keywords: expand, outpaint, outpainting, extend, aspect ratio, widen, horizontal to vertical, گسترش, بزرگ‌تر کردن, نسبت تصویر, افقی به عمودی
- Source: AI video and image prompt book

Expand this image beyond its current borders to [ASPECT_RATIO/SIZE] while keeping everything inside the original image unchanged. Naturally continue the existing background, environment, floor, walls, sky, scenery, objects, lighting, textures, and patterns.

## remove-element · Remove a person or object (حذف سوژه یا اشیای اضافی)
- Use when: remove
- Studio: no (needs an AI video tool)
- Keywords: remove, erase, delete object, get rid of, clean up the frame, حذف, پاک کردن
- Source: AI video and image prompt book

Remove [OBJECT/PERSON] from the entire video/image while keeping everything else unchanged. Reconstruct the missing area naturally using the surrounding environment and background details. Maintain consistent lighting, shadows, textures, camera movement, and frame-to-frame continuity.

## replace-object · Replace an object (جایگزینی اشیا)
- Use when: replace
- Studio: no (needs an AI video tool)
- Keywords: replace object, swap object, change the object, جایگزینی, عوض کردن شیء, تعویض شیء
- Source: AI video and image prompt book

Replace [EXISTING_OBJECT] with [NEW_OBJECT] throughout the video. Make the new object match the original position, size, perspective, lighting, and movement. Keep the rest of the scene unchanged and make the replacement look naturally integrated.

## outfit-swap · Change the outfit (تغییر استایل لباس)
- Use when: outfit, clothes
- Studio: no (needs an AI video tool)
- Keywords: outfit, clothes, clothing, wear, dress, لباس, استایل, پوشش
- Source: AI video and image prompt book

Change the person's current outfit to [DESIRED_OUTFIT/STYLE]. Keep their face, hairstyle, body shape, pose, expressions, and movements exactly the same. Make the new clothing follow realistic fabric movement, lighting, shadows, and body proportions throughout the video.

## wrinkle-remover · Remove clothing wrinkles (رفع چروک لباس)
- Use when: wrinkles
- Studio: no (needs an AI image tool)
- Keywords: wrinkle, crease, چروک
- Source: AI video and image prompt book

Smooth distracting wrinkles, creases, bunching, and uneven fabric while keeping the clothing's material, fit, seams, texture, and natural folds realistic. Make the outfit look neat and well-presented without making it appear digitally painted.

## fix-closed-eyes · Fix closed eyes (اصلاح چشمان بسته)
- Use when: eyes
- Studio: no (needs an AI image tool; useful for a thumbnail frame)
- Keywords: closed eyes, blink, چشم بسته, پلک
- Source: AI video and image prompt book

Correct the person's closed or half-closed eyes so they look naturally open and consistent with their face. Preserve the expression, gaze direction, lighting, eye shape, identity, and overall appearance. Keep the edit subtle and realistic.

## retouch · Professional face retouch (روتوش حرفه‌ای چهره)
- Use when: retouch, skin
- Studio: no (needs an AI image tool)
- Keywords: retouch, skin, blemish, روتوش, پوست
- Source: AI video and image prompt book

Professionally retouch this image while preserving the person's identity, facial features, skin texture, body proportions, hairstyle, clothing, and overall appearance. Improve lighting, sharpness, color balance, exposure, and clarity naturally.

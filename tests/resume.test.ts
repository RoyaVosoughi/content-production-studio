import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { studioDb } from "./fixtures/brand";
import { createAnimation, requireAnimation } from "@/lib/animations";
import type { Db } from "@/lib/db/client";
import { animations, footage, jobResumes, type Word } from "@/lib/db/schema";
import { MAX_RESUMES, resumeInterruptedWork } from "@/lib/resume";
import type { StudioDeps } from "@/lib/studio";
import type { Transcriber } from "@/lib/video/footage";
import { FFMPEG, run } from "@/lib/video/tools";

// A restart, a crash or a closed laptop leaves work marked as busy with nothing doing it.
// When the studio starts again, it picks that work up by itself.

const WORDS: Word[] = [
  { text: "Agents", start: 0.2, end: 0.6 },
  { text: "save", start: 0.6, end: 0.9 },
  { text: "time.", start: 0.9, end: 1.3 },
];
const transcribe: Transcriber = async () => WORDS;

let dataDir: string;
let clipFile: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "studio-resume-test-"));
  process.env.VIDEO_DATA_DIR = dataDir;
  clipFile = path.join(dataDir, "clip.mp4");
  await run(FFMPEG(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=s=320x240:r=15:d=3",
    "-i", path.resolve("tests/fixtures/speech-en.wav"),
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", clipFile,
  ]);
}, 60_000);

afterAll(async () => {
  delete process.env.VIDEO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("picking up work a restart cut off", () => {
  let db: Db;
  let deps: Pick<StudioDeps, "db" | "writer">;
  const planAnimation = vi.fn();

  /** A clip the studio was reading when it stopped: busy in the database, with no job running. */
  async function cutOffClip() {
    const file = `${randomUUID()}.mp4`;
    await mkdir(path.join(dataDir, "footage"), { recursive: true });
    await copyFile(clipFile, path.join(dataDir, "footage", file));
    const [row] = await db
      .insert(footage)
      .values({ pairId: randomUUID(), language: "en", file, originalName: "take.mp4", size: 1, status: "processing", stage: "transcribing", progress: 0.4 })
      .returning({ id: footage.id });
    return row.id;
  }

  beforeEach(async () => {
    db = await studioDb();
    planAnimation.mockReset();
    planAnimation.mockResolvedValue({ scenes: [{ kind: "title", say: "Agents", heading: "Agents", text: "", items: [] }] });
    deps = { db, writer: { planAnimation } as unknown as StudioDeps["writer"] };
  });

  it("reads a cut-off clip again from the start, and finishes it", async () => {
    const id = await cutOffClip();
    expect(await resumeInterruptedWork(deps, { transcribe })).toBe(1);
    const [clip] = await db.select().from(footage).where(eq(footage.id, id));
    expect(clip).toMatchObject({ status: "ready", stage: null, error: null });
    expect(clip.phrases?.[0].text).toBe("Agents save time.");
    // Once finished, the count of pick-ups is cleared.
    expect(await db.select().from(jobResumes)).toEqual([]);
  });

  it("plans the scenes again when planning was cut off", async () => {
    const id = await createAnimation(deps, { language: "en", platform: "reel", title: "Agents", script: "Agents save time.", mode: "simple" });
    await db.update(animations).set({ planStatus: "planning" }).where(eq(animations.id, id));
    expect(await resumeInterruptedWork(deps)).toBe(1);
    expect(planAnimation).toHaveBeenCalledTimes(1);
    expect((await requireAnimation(db, id)).planStatus).toBeNull();
  });

  it("stops picking up a job that was cut off twice in a row, and says so", async () => {
    const id = await cutOffClip();
    await db.insert(jobResumes).values({ key: `footage:${id}`, count: MAX_RESUMES });
    const reading = vi.fn(transcribe);
    await resumeInterruptedWork(deps, { transcribe: reading });
    expect(reading).not.toHaveBeenCalled();
    const [clip] = await db.select().from(footage).where(eq(footage.id, id));
    expect(clip.status).toBe("failed");
    expect(clip.error).toMatch(/twice in a row/);
    // Trying again by hand starts afresh.
    expect(await db.select().from(jobResumes)).toEqual([]);
  });

  it("leaves finished and failed work alone", async () => {
    const id = await cutOffClip();
    await db.update(footage).set({ status: "failed", error: "No speech." }).where(eq(footage.id, id));
    expect(await resumeInterruptedWork(deps, { transcribe })).toBe(0);
  });
});

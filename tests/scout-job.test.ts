import { describe, expect, it } from "vitest";
import { currentScoutJob, scoutIsRunning, startScoutJob, stopScoutJob } from "@/lib/scout-job";

const describeError = (error: unknown) => (error instanceof Error ? error.message : "failed");

/** Waits until the background job has settled. */
async function settled() {
  for (let i = 0; i < 50 && scoutIsRunning(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("the idea scout's background search", () => {
  it("reports how many ideas were saved", async () => {
    startScoutJob("en", async () => 5, describeError);
    await settled();
    expect(currentScoutJob()).toMatchObject({ status: "done", count: 5, error: null });
  });

  it("stops at the next step when asked, and saves nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let saved = false;
    startScoutJob(
      "en",
      async (stopIfAsked) => {
        await gate;
        stopIfAsked();
        saved = true;
        return 5;
      },
      describeError,
    );
    expect(scoutIsRunning()).toBe(true);
    expect(stopScoutJob()).toBe(true);
    release();
    await settled();
    expect(saved).toBe(false);
    expect(currentScoutJob()?.status).toBe("stopped");
  });

  it("runs one search at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    expect(startScoutJob("en", async () => (await gate, 1), describeError)).not.toBeNull();
    expect(startScoutJob("en", async () => 2, describeError)).toBeNull();
    release();
    await settled();
    expect(stopScoutJob()).toBe(false);
  });

  it("keeps the reason when the search fails", async () => {
    startScoutJob(
      "en",
      async () => {
        throw new Error("No search key");
      },
      describeError,
    );
    await settled();
    expect(currentScoutJob()).toMatchObject({ status: "failed", error: "No search key" });
  });
});

describe("a search cut off by a restart", () => {
  it("shows as failed with a message when the studio starts again, once", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { noteScoutRunning, clearScoutNote, recoverCutOffScout } = await import("@/lib/scout-job");
    const dir = await mkdtemp(path.join(os.tmpdir(), "studio-scout-note-"));
    try {
      // A search that finished leaves nothing behind.
      await noteScoutRunning("fa", dir);
      await clearScoutNote(dir);
      delete (globalThis as { __studioScoutJob?: unknown }).__studioScoutJob;
      expect(await recoverCutOffScout(dir)).toBe(false);
      expect(currentScoutJob()).toBeNull();

      // One cut off by a restart: the studio starts with nothing in memory, but the note is there.
      await noteScoutRunning("fa", dir);
      expect(await recoverCutOffScout(dir)).toBe(true);
      expect(currentScoutJob()).toMatchObject({ status: "failed", language: "fa", error: expect.stringMatching(/nothing was saved/) });
      expect(scoutIsRunning()).toBe(false);
      expect(await recoverCutOffScout(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

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

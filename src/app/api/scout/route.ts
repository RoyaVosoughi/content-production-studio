import { currentScoutJob, stopScoutJob } from "@/lib/scout-job";

export const dynamic = "force-dynamic";

/** The idea scout's latest search, for the progress panel to check on. */
export async function GET() {
  return Response.json({ job: currentScoutJob() }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Stops the running search at its next step. A plain request rather than a server action, because the
 * browser runs server actions one at a time and this one must not wait behind anything.
 */
export async function DELETE() {
  return Response.json({ stopping: stopScoutJob(), job: currentScoutJob() });
}

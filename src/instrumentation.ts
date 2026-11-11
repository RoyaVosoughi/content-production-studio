// Runs once when the studio starts: from then on it checks for scheduled posts whose time has come.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Not while building, and not when turned off, as tests and test copies do.
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.STUDIO_SCHEDULER === "off") return;
  const { startScheduler } = await import("./lib/schedule");
  startScheduler();
}

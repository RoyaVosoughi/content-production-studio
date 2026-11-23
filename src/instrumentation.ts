// Runs once when the studio starts: from then on it checks for scheduled posts whose time has come,
// and it picks up any work a restart cut off, such as reading a clip or making a video.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // `npm run demo` opens its own database in .data/demo and fills it with sample data the first time.
  if (process.env.STUDIO_DEMO === "1") {
    const [{ getDb }, { seedDemo }] = await Promise.all([import("./lib/db/client"), import("./lib/demo")]);
    if (await seedDemo(await getDb())) console.log("Demo studio filled with sample data.");
  }
  // Not when turned off, as tests and test copies do.
  if (process.env.STUDIO_SCHEDULER === "off") return;
  const [{ startScheduler }, { startResuming }] = await Promise.all([import("./lib/schedule"), import("./lib/resume")]);
  startScheduler();
  startResuming();
}

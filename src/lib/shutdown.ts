// Node-only graceful shutdown. Imported dynamically from instrumentation.ts
// when NEXT_RUNTIME === "nodejs" so the Edge Runtime build never sees these
// `process.once` calls (which Edge flags as unsupported).

let registered = false;

export async function registerShutdown() {
  if (registered) return;
  registered = true;

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, draining DB pool`);
    try {
      const { pool } = await import("@/db");
      await pool.end();
      console.log("[shutdown] pool drained");
    } catch (err) {
      console.error("[shutdown] failed to drain pool", err);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

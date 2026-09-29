import { start } from "./server";

try {
  const server = await start(process.env);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      server.close().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error("Shutdown failed:", err instanceof Error ? err.message : err);
          process.exit(1);
        },
      );
    });
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

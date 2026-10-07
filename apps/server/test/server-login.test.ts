import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, inject, vi } from "vitest";
import { testEnv } from "./config";

const PASSWORD = "hunter2apppass";
const failure = vi.hoisted(() => ({ error: undefined as Error | undefined }));

vi.mock("../src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/client")>()),
  enableAppLogin: () => Promise.reject(failure.error),
}));

const { start } = await import("../src/server");

const env = () =>
  testEnv({
    DATABASE_URL: inject("databaseUrl"),
    APP_DATABASE_URL: `postgres://belay_app:${PASSWORD}@localhost:1/belay`,
    WEB_DIST: mkdtempSync(join(tmpdir(), "belay-login-")),
  });

describe("start when the app role cannot be given its login", () => {
  it("names the reason without the password, and attaches no cause", async () => {
    // What Drizzle throws: the statement, with its parameters, wraps the driver's error.
    failure.error = new Error(`Failed query: select format('%L', $1)\nparams: ${PASSWORD}`, {
      cause: new Error("permission denied to alter role"),
    });
    const err = (await start(env()).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/Cannot set the belay_app password: permission denied/);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.cause).toBeUndefined();
  });

  it("does not echo the statement when the failure has no underlying cause", async () => {
    failure.error = new Error(`Failed query: alter role belay_app password '${PASSWORD}'`);
    const err = (await start(env()).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/Cannot set the belay_app password/);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.cause).toBeUndefined();
  });
});

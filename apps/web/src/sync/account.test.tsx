import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "@/lib/api";
import { fakeApi } from "@/test/fake-api";
import { type OpenAccount, AccountProvider, useAccount, useWeighings } from "./account";
import * as dbModule from "./db";
import { openAccountDb, readWeights, recordChange } from "./db";
import { readLastUser, writeLastUser } from "./last-user";

vi.mock("./db", async (original) => {
  const actual = await original<typeof import("./db")>();
  return { ...actual, openAccountDb: vi.fn(actual.openAccountDb) };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The session answer arrives late, so the last account on the device opens (and syncs) first.
function slowMe(api: ReturnType<typeof fakeApi>) {
  const real = api.fetchMock.getMockImplementation()!;
  api.fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === "/api/me") await sleep(150);
    return real(input, init);
  });
}

const ADA = { id: "user-ada", displayName: "Ada" };
const BOB = { id: "user-bob", displayName: "Bob" };

function Weighings({ account }: { account: OpenAccount }) {
  const { data } = useWeighings(account);
  return <p>{data ? `${account.user.displayName}: ${data.length} weigh-ins` : "reading"}</p>;
}

function Probe() {
  const account = useAccount();
  if (account.kind === "open") return <Weighings account={account} />;
  if (account.kind === "signed-out")
    return <p>{`signed out${account.unreachable ? ", unreachable" : ""}`}</p>;
  return <p>{account.kind}</p>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountProvider>
        <Probe />
      </AccountProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function weighIn(userId: string) {
  const db = await openAccountDb(userId);
  await recordChange(db, {
    kind: "weight",
    date: "2026-10-07",
    weightKg: 79.8,
    at: "2026-10-07T06:30:00.000Z",
  });
  db.close();
}

describe("the current account", () => {
  it("opens the signed-in account and remembers it on the device", async () => {
    fakeApi({ me: ADA });
    mount();
    expect(await screen.findByText("Ada: 0 weigh-ins")).toBeTruthy();
    expect(readLastUser()).toEqual(ADA);
  });

  it("opens the last account from the device when offline", async () => {
    await weighIn(ADA.id);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    mount();
    expect(await screen.findByText("Ada: 1 weigh-ins")).toBeTruthy();
  });

  it("keeps the last account open when its session expired, so its entries wait", async () => {
    await weighIn(ADA.id);
    writeLastUser(ADA);
    fakeApi({ me: null });
    mount();
    expect(await screen.findByText("Ada: 1 weigh-ins")).toBeTruthy();
  });

  it("is signed out with no account on the device", async () => {
    fakeApi({ me: null });
    mount();
    expect(await screen.findByText("signed out")).toBeTruthy();
  });

  it("says the server is unreachable when there is no account to open", async () => {
    fakeApi({ me: "down" });
    mount();
    expect(await screen.findByText("signed out, unreachable")).toBeTruthy();
  });

  it("switches to the account that signed in, and never sends the other one's entries", async () => {
    await weighIn(ADA.id);
    writeLastUser(ADA);
    const api = fakeApi({ me: BOB });
    slowMe(api);
    mount();
    // Ada's account opens first and tries her queue under Bob's session: refused with a 409.
    await waitFor(() => expect(api.requests.map((r) => r.account)).toContain(ADA.id));
    expect(api.requests[0]!.account).toBe(ADA.id);
    expect(api.requests[0]!.changes).toHaveLength(1);
    expect(await screen.findByText("Bob: 0 weigh-ins")).toBeTruthy();
    expect(readLastUser()).toEqual(BOB);
    await waitFor(() => expect(api.requests.some((r) => r.account === BOB.id)).toBe(true));
    expect(
      api.requests.filter((r) => r.account === BOB.id).every((r) => r.changes.length === 0),
    ).toBe(true);
    expect([...api.rows.values()]).toEqual([]); // Ada's change was never accepted
    expect(await readWeights(await openAccountDb(ADA.id))).toHaveLength(1);
  });

  it("stops the previous account's engine when the account switches", async () => {
    await weighIn(ADA.id);
    writeLastUser(ADA);
    const api = fakeApi({ me: BOB });
    slowMe(api);
    mount();
    expect(await screen.findByText("Bob: 0 weigh-ins")).toBeTruthy();
    await sleep(30);
    api.requests.length = 0;
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    await sleep(30);
    expect(api.requests.map((r) => r.account)).not.toContain(ADA.id);
  });

  it("stops the engine when the provider unmounts", async () => {
    const api = fakeApi({ me: ADA });
    mount();
    expect(await screen.findByText("Ada: 0 weigh-ins")).toBeTruthy();
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    cleanup();
    const sent = api.requests.length;
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await sleep(50);
    expect(api.requests).toHaveLength(sent);
  });

  it("reopens the database when the connection is lost, and writes and syncs again", async () => {
    const api = fakeApi({ me: ADA });
    let account: OpenAccount | undefined;
    function Capture() {
      const a = useAccount();
      if (a.kind === "open") account = a;
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AccountProvider>
          <Capture />
        </AccountProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(account).toBeDefined());
    const first = account!;
    const open = vi.mocked(dbModule.openAccountDb);
    const calls = open.mock.calls.length;
    first.db.close(); // the browser dropped it
    open.mock.calls[calls - 1]![1]!.onLost!();
    await waitFor(() => expect(open.mock.calls.length).toBe(calls + 1));
    await waitFor(() => expect(account!.db).not.toBe(first.db));
    const change = {
      kind: "weight" as const,
      date: "2026-10-07",
      weightKg: 79.8,
      at: "2026-10-07T06:30:00.000Z",
    };
    await recordChange(account!.db, change);
    await account!.engine.sync();
    expect(account!.engine.status()).toBe("idle");
    expect(api.requests.at(-1)!.changes).toEqual([change]);
    expect(api.rows.get("2026-10-07")?.weightKg).toBe(79.8);
  });

  it("says so when the browser refuses the local database", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("The user denied permission", "SecurityError");
    });
    mount();
    expect(await screen.findByText("unavailable")).toBeTruthy();
  });
});

describe("signing out", () => {
  it("forgets the account on the device but keeps its data", async () => {
    await weighIn(ADA.id);
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    await logout();
    expect(assign).toHaveBeenCalledWith("https://idp.example/logout");
    expect(readLastUser()).toBeNull();
    expect(await readWeights(await openAccountDb(ADA.id))).toHaveLength(1);
  });

  it("keeps the account when the server could not sign out", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA, logout: async () => new Response("Bad Gateway", { status: 502 }) });
    await expect(logout()).rejects.toThrow();
    await waitFor(() => expect(readLastUser()).toEqual(ADA));
  });
});

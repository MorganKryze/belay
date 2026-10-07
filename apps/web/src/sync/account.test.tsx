import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "@/lib/api";
import { fakeApi } from "@/test/fake-api";
import { type OpenAccount, AccountProvider, useAccount, useWeighings } from "./account";
import { openAccountDb, readWeights, recordChange } from "./db";
import { readLastUser, writeLastUser } from "./last-user";

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
    mount();
    expect(await screen.findByText("Bob: 0 weigh-ins")).toBeTruthy();
    expect(readLastUser()).toEqual(BOB);
    expect(await readWeights(await openAccountDb(ADA.id))).toHaveLength(1);
    expect([...api.rows.values()]).toEqual([]); // Ada's queue, tried under Bob's session: refused
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

import "@/i18n/lazy";
import { newId } from "@belay/shared";
import {
  isCreatineName,
  isSupplementName,
  SUPPLEMENT_NAME_MAX,
  SUPPLEMENT_SUGGESTIONS,
} from "@belay/shared/body/supplements";
import type { SupplementRow } from "@belay/shared/sync/schema";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Ellipsis, Plus } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Toast, useWriter } from "@/components/weigh-in";
import { type OpenAccount, useAccount, useSupplements } from "@/sync/account";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 font-medium text-primary";
const sectionTitle = "mx-0.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase";
const field =
  "min-h-12 w-full min-w-0 rounded-field border border-input bg-card px-4 text-base outline-offset-2";

// Case and accents aside: "Oméga-3" is "omega-3".
const plain = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

// Settings › My supplements (§4.4): a free list, suggestions added in one tap, no dose, no advice.
export function Supplements() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link to="/settings" activeOptions={{ exact: true }} className={back}>
          <ChevronLeft aria-hidden className="size-5" />
          {t("settings.title")}
        </Link>
        <h1
          tabIndex={-1}
          data-focus-fallback
          className="text-[26px] leading-tight font-bold tracking-tight outline-none"
        >
          {t("supplementsPage.title")}
        </h1>
      </div>
      {account.kind === "open" && <SupplementList account={account} />}
      {account.kind === "unavailable" && <p>{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <>
          <p>{t("body.signedOut")}</p>
          <Button asChild className="self-start">
            <a href={`/auth/login?returnTo=${encodeURIComponent("/settings/supplements")}`}>
              {t("home.signIn")}
            </a>
          </Button>
        </>
      )}
    </section>
  );
}

function SupplementList({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const all = useSupplements(account).data;
  const { write, toast, error, dismiss } = useWriter(account);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState<"name" | "duplicate" | null>(null);
  const pending = useRef(new Set<string>());
  const nameId = useId();
  if (!all) return null;
  const active = all.filter((s) => !s.removed);
  // `fromField`: the typed name is cleared once added; a suggestion leaves the field alone.
  const add = async (value: string, fromField: boolean) => {
    const trimmed = value.trim();
    const key = plain(trimmed);
    if (pending.current.has(key)) return; // a second tap while the first is being written
    if (!isSupplementName(trimmed)) return setInvalid("name");
    if (active.some((s) => plain(s.name) === plain(trimmed))) return setInvalid("duplicate");
    setInvalid(null);
    const id = newId();
    pending.current.add(key);
    try {
      const ok = await write(
        [{ kind: "supplement", id, field: "name", value: trimmed }],
        [{ kind: "supplement", id, field: "removed", value: true }],
        t("supplementsPage.toastAdded"),
      );
      if (ok && fromField) setName("");
    } finally {
      pending.current.delete(key);
    }
  };
  // A suggestion leaves once a supplement of that name is on the list.
  const suggestions = SUPPLEMENT_SUGGESTIONS.filter((key) => {
    const label = t(`supplementsPage.suggestions.${key}`);
    return !active.some((s) =>
      key === "creatine" ? isCreatineName(s.name) : plain(s.name) === plain(label),
    );
  });
  return (
    <>
      {active.length > 0 ? (
        <ul className="flex flex-col rounded-card border border-border bg-card px-4">
          {active.map((s) => (
            <SupplementItem key={s.id} supplement={s} others={active} write={write} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("supplementsPage.empty")}</p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <section aria-labelledby="add-supplement" className="flex flex-col gap-2">
        <h2 id="add-supplement" className={sectionTitle}>
          {t("supplementsPage.add")}
        </h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void add(name, true);
          }}
        >
          <label htmlFor={nameId} className="sr-only">
            {t("supplementsPage.name")}
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={SUPPLEMENT_NAME_MAX}
            placeholder={t("supplementsPage.name")}
            autoComplete="off"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? `${nameId}-error` : undefined}
            className={field}
            onChange={(e) => setName(e.target.value)}
          />
          {invalid && (
            <p id={`${nameId}-error`} className="text-[13px] font-medium text-primary-ink">
              {t(
                invalid === "duplicate" ? "supplementsPage.duplicate" : "supplementsPage.nameError",
              )}
            </p>
          )}
          <Button type="submit" className="h-12 rounded-field text-base font-semibold">
            {t("supplementsPage.add")}
          </Button>
        </form>
        {suggestions.length > 0 && (
          <>
            <h3 className="mt-2 text-[13px] text-muted-foreground">
              {t("supplementsPage.suggestionsTitle")}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-input px-3 text-sm text-muted-foreground"
                    onClick={() => void add(t(`supplementsPage.suggestions.${key}`), false)}
                  >
                    <Plus aria-hidden className="size-4" />
                    {t(`supplementsPage.suggestions.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-[13px] text-muted-foreground">{t("supplementsPage.note")}</p>
      </section>
      <Toast toast={toast} onDone={dismiss} />
    </>
  );
}

// One supplement: its name, the creatine mark, and "⋯" for Rename and Remove.
function SupplementItem({
  supplement: s,
  others,
  write,
}: {
  supplement: SupplementRow;
  others: SupplementRow[]; // the active list, this one included
  write: ReturnType<typeof useWriter>["write"];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"name" | "duplicate" | null>(null);
  const errorId = useId();
  const menuId = useId();
  const more = useRef<HTMLButtonElement>(null);
  const backToMore = useRef(false);
  useEffect(() => {
    if (renaming === null && backToMore.current) {
      backToMore.current = false;
      more.current?.focus();
    }
  }, [renaming]);
  if (renaming !== null) {
    return (
      <li className="border-t border-border py-3 first:border-t-0">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isSupplementName(renaming)) return setInvalid("name");
            // Its own name stays allowed: only another supplement's counts.
            if (others.some((o) => o.id !== s.id && plain(o.name) === plain(renaming)))
              return setInvalid("duplicate");
            setInvalid(null);
            void write(
              [{ kind: "supplement", id: s.id, field: "name", value: renaming.trim() }],
              [{ kind: "supplement", id: s.id, field: "name", value: s.name }],
              t("supplementsPage.toastRenamed"),
            ).then((ok) => {
              if (!ok) return;
              backToMore.current = true;
              setRenaming(null);
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            {t("supplementsPage.newName", { name: s.name })}
            <input
              value={renaming}
              maxLength={SUPPLEMENT_NAME_MAX}
              autoComplete="off"
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
              className={`${field} font-normal`}
              onChange={(e) => setRenaming(e.target.value)}
              autoFocus
            />
          </label>
          {invalid && (
            <p id={errorId} className="text-[13px] font-medium text-primary-ink">
              {t(
                invalid === "duplicate" ? "supplementsPage.duplicate" : "supplementsPage.nameError",
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{t("supplementsPage.save")}</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                backToMore.current = true;
                setInvalid(null);
                setRenaming(null);
              }}
            >
              {t("settings.cancel")}
            </Button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="border-t border-border first:border-t-0">
      <div className="flex min-h-12 items-center gap-2 py-1">
        <span className="min-w-0 flex-1 break-words">{s.name}</span>
        {s.kind === "creatine" && (
          <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-muted-foreground">
            {t("supplementsPage.marked")}
          </span>
        )}
        <button
          ref={more}
          type="button"
          aria-label={t("supplementsPage.more", { name: s.name })}
          aria-expanded={open}
          aria-controls={menuId}
          className="-mr-2 grid size-11 shrink-0 place-items-center rounded-chip text-muted-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          <Ellipsis aria-hidden className="size-5" />
        </button>
      </div>
      {open && (
        <div id={menuId} className="flex flex-wrap gap-2 pb-3">
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              setInvalid(null);
              setRenaming(s.name);
            }}
          >
            {t("supplementsPage.rename")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void write(
                [{ kind: "supplement", id: s.id, field: "removed", value: true }],
                [{ kind: "supplement", id: s.id, field: "removed", value: false }],
                t("supplementsPage.toastRemoved"),
              ).then((ok) => ok && document.querySelector<HTMLElement>("h1")?.focus())
            }
          >
            {t("supplementsPage.remove")}
          </Button>
        </div>
      )}
    </li>
  );
}

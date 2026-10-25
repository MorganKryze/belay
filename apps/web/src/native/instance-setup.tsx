// « Ton instance »: the iPhone app carries no server of its own, so its first launch asks for the
// instance's address and checks that Belay answers there. Loaded on the phone only.
import "@/i18n/lazy";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarLink } from "@/components/avatar";
import { FieldError } from "@/components/field-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { nativeSession, writeInstance } from "@/lib/platform";
import { checkAddress, probeInstance } from "./address";

type Failure = "invalid" | "insecure" | "offline" | "unreachable" | "not-belay";
const LINES: Record<Failure, string> = {
  invalid: "native.instance.invalid",
  insecure: "native.instance.insecure",
  offline: "native.instance.offline",
  unreachable: "native.instance.unreachable",
  "not-belay": "native.instance.notBelay",
};

// The address as a person types it: a stored origin shows without its https://.
const typed = (origin: string | undefined) => origin?.replace(/^https:\/\//, "") ?? "";

export function InstanceSetup({ current, onCancel }: { current?: string; onCancel?: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(() => typed(current));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;

  const fail = (reason: Failure) => {
    setFailure(reason);
    setBusy(false);
    // Back in the field, keyboard up, to correct the address.
    input.current?.focus();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || address.trim() === "") return;
    const checked = checkAddress(address);
    if ("error" in checked) return fail(checked.error);
    setFailure(null);
    setBusy(true);
    const probe = await probeInstance(checked.origin);
    if ("error" in probe) return fail(probe.error);
    writeInstance(probe.origin);
    if (probe.origin !== current) {
      // A token left behind stays bound to its own origin in the Keychain, so the new instance
      // never receives it: the restart goes ahead even if removing it failed.
      await nativeSession()
        ?.forget()
        .catch(() => {});
    }
    // The app starts again on the stored instance, its token read before the first request.
    location.replace("/");
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t("native.instance.title")}
        trailing={
          <div className="lg:hidden">
            <AvatarLink />
          </div>
        }
      >
        <p className="mt-1.5 text-body text-muted-foreground">{t("native.instance.intro")}</p>
      </PageHeader>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold">
          {t("native.instance.label")}
        </label>
        <input
          ref={input}
          id={id}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="url"
          spellCheck={false}
          enterKeyHint="go"
          value={address}
          readOnly={busy}
          placeholder={t("native.instance.placeholder")}
          aria-invalid={failure ? true : undefined}
          aria-describedby={failure ? errorId : undefined}
          className="field w-full min-w-0 px-4 text-base read-only:text-muted-foreground"
          onChange={(e) => {
            setAddress(e.target.value);
            // No reproach while the address is being corrected; it comes back at the next try.
            setFailure(null);
          }}
        />
        {failure && <FieldError id={errorId}>{t(LINES[failure])}</FieldError>}
        <Button type="submit" busy={busy} disabled={address.trim() === ""} className="mt-2">
          {t(busy ? "native.instance.checking" : "native.instance.continue")}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="text"
            disabled={busy}
            onClick={onCancel}
            className="self-center"
          >
            {t("native.instance.cancel")}
          </Button>
        )}
      </form>
      {/* Accueil's link to the tools, which work without an account. Under Annuler it sits
          apart: two quiet links one under the other would read as one list. */}
      <Link
        to="/tools"
        className={`-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary${onCancel ? " mt-2" : ""}`}
      >
        {t("home.toolsLink")}
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </section>
  );
}

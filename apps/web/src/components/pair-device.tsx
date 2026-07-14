"use client";

import { useState } from "react";

interface EnrollmentCode {
  enrollmentToken: string;
  expiresInSeconds: number;
}

export function PairDevice() {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setStatus(null);
    setCode(null);
    setCopied(false);
    try {
      const res = await fetch("/api/devices/enrollment-code", { method: "POST" });
      if (res.status === 401) {
        setStatus("sign in with google to pair a mac.");
      } else if (res.status === 503) {
        setStatus("no database connected — pairing is disabled in demo mode.");
      } else if (!res.ok) {
        setStatus("couldn't generate a code — try again.");
      } else {
        const body = (await res.json()) as EnrollmentCode;
        setCode(body.enrollmentToken);
      }
    } catch {
      setStatus("network error — try again.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (code === null) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus("couldn't copy — select the code and copy manually.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="btn-dark self-start" onClick={generate} disabled={pending}>
        {pending ? "generating…" : code ? "generate a new code" : "pair a mac"}
      </button>

      {status !== null && <p className="text-sm text-mute">{status}</p>}

      {code !== null && (
        <div className="inset-group flex flex-col gap-3 p-4">
          <p className="text-xs text-mute">
            expires in 10 minutes. copy soon on your mac and choose{" "}
            <span className="font-semibold text-ink">pair device</span> from the menu bar — it
            reads this code from your clipboard.
          </p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-card border border-hairline bg-card px-3 py-2 font-mono text-xs text-charcoal">
              {code}
            </code>
            <button className="btn-outline btn-sm shrink-0" onClick={copy}>
              {copied ? "copied" : "copy"}
            </button>
          </div>
          <p className="text-xs text-ash">
            headless setup: run the mac app with{" "}
            <span className="font-mono">SOON_ENROLLMENT_CODE=…</span>
          </p>
        </div>
      )}
    </div>
  );
}

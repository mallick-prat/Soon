"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** posts a card action to a route handler, then refreshes the page data */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(url: string, body: unknown, label: string) {
    setPending(label);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 503) {
        setMessage("no database connected — actions are disabled in demo mode");
      } else if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setMessage(payload?.error ?? "something went wrong");
      } else {
        router.refresh();
      }
    } catch {
      setMessage("network error — try again");
    } finally {
      setPending(null);
    }
  }

  return { run, pending, message };
}

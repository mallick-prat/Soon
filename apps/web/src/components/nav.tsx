"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/upcoming", label: "upcoming" },
  { href: "/approvals", label: "approvals" },
  { href: "/scheduled", label: "scheduled" },
  { href: "/preferences", label: "preferences" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas">
      <div className="mx-auto flex h-[60px] w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="display text-xl tracking-tight text-ink">
          soon
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold leading-none transition-colors",
                  active
                    ? "bg-surface-dark text-on-dark"
                    : "text-charcoal hover:bg-bone hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

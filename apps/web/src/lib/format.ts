/** all output lowercase to match the product voice */

export function formatDayTime(iso: string, timezone?: string): string {
  const date = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  };
  return new Intl.DateTimeFormat("en-US", opts).format(date).toLowerCase();
}

export function formatTime(iso: string, timezone?: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  })
    .format(date)
    .toLowerCase();
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = then - now.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  let phrase: string;
  if (minutes < 1) phrase = "now";
  else if (minutes < 60) phrase = `${minutes}m`;
  else if (hours < 24) phrase = `${hours}h`;
  else phrase = `${days}d`;
  if (phrase === "now") return "just now";
  return diffMs < 0 ? `${phrase} ago` : `in ${phrase}`;
}

export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toLowerCase();
}

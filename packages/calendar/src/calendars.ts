import type { CalendarApi, CalendarListing } from "./types.js";

const WRITABLE_ACCESS_ROLES = new Set(["owner", "writer"]);

/** list the user's calendars shaped for onboarding calendar selection. */
export async function listCalendars(api: CalendarApi): Promise<CalendarListing[]> {
  const entries = await api.listCalendars();
  const listings: CalendarListing[] = [];
  for (const entry of entries) {
    if (entry.id === undefined || entry.id === "") continue;
    listings.push({
      id: entry.id,
      summary: entry.summary ?? "",
      writable: entry.accessRole !== undefined && WRITABLE_ACCESS_ROLES.has(entry.accessRole),
      primary: entry.primary === true,
    });
  }
  return listings;
}

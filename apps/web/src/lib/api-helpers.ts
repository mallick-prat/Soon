import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@soon/database";
import type { ZodType } from "zod";

/** 503 response used by every db-backed route when DATABASE_URL is missing */
export function requireDatabase(): NextResponse | null {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "database not configured — set DATABASE_URL" },
      { status: 503 },
    );
  }
  return null;
}

export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      data: null,
      error: NextResponse.json({ error: "invalid json body" }, { status: 400 }),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      data: null,
      error: NextResponse.json(
        { error: "validation failed", issues: result.error.issues },
        { status: 422 },
      ),
    };
  }
  return { data: result.data, error: null };
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 });
}

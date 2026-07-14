import { z } from "zod";
import { EnvValidationError } from "./errors.js";

/**
 * validate environment variables against a zod object schema.
 * throws {@link EnvValidationError} naming the offending variables — never
 * their values — so the error is safe to log.
 */
export function requireEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const variables = [
    ...new Set(
      result.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"),
    ),
  ];
  throw new EnvValidationError(
    `invalid environment: ${variables.join(", ")}`,
    variables,
  );
}

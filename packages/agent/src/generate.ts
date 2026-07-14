import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";

export interface GenerateStructuredOptions<SCHEMA extends z.ZodType> {
  model: LanguageModel;
  schema: SCHEMA;
  system: string;
  prompt: string;
  schemaName?: string;
}

/**
 * generateObject with one deterministic retry when the model output fails
 * schema validation (generateObject's own maxRetries only covers api errors).
 */
export async function generateStructured<SCHEMA extends z.ZodType>(
  options: GenerateStructuredOptions<SCHEMA>,
): Promise<z.infer<SCHEMA>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateObject({
        model: options.model,
        schema: options.schema,
        system: options.system,
        prompt: options.prompt,
        ...(options.schemaName !== undefined ? { schemaName: options.schemaName } : {}),
        maxRetries: 0,
      });
      return options.schema.parse(result.object);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

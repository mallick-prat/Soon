import { z } from "zod";
import { requireEnv } from "@soon/security";

const gatewayEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    NODE_ENV: z.string().default("production"),
    LOG_LEVEL: z.string().optional(),
    /** shared bearer token guarding POST /internal/commands */
    INTERNAL_API_TOKEN: z.string().min(16),
    /** hmac secret used to verify CloudCommand envelope signatures */
    DEVICE_SIGNING_SECRET: z.string().min(16),
    /** spki pem public key for EdDSA/ES256 device jwts (preferred) */
    REALTIME_JWT_PUBLIC_KEY: z.string().optional(),
    /** hs256 shared-secret fallback for device jwts */
    DEVICE_JWT_SECRET: z.string().min(16).optional(),
  })
  .refine((env) => env.REALTIME_JWT_PUBLIC_KEY !== undefined || env.DEVICE_JWT_SECRET !== undefined, {
    message: "either REALTIME_JWT_PUBLIC_KEY or DEVICE_JWT_SECRET is required",
    path: ["REALTIME_JWT_PUBLIC_KEY"],
  });

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;

export function loadConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): GatewayConfig {
  return requireEnv(gatewayEnvSchema, source);
}

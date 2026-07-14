import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

let singleton: PrismaClient | undefined;

/** true when a postgres connection string is available */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * lazy prisma singleton — the client is only constructed on first call,
 * so builds and tests never need DATABASE_URL.
 */
export function getDb(): PrismaClient {
  if (!singleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — the database client cannot be created. " +
          "set it in the environment before calling getDb().",
      );
    }
    const adapter = new PrismaPg({ connectionString });
    singleton = new PrismaClient({ adapter });
  }
  return singleton;
}

/** test hook / graceful shutdown — disconnects and clears the singleton */
export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}

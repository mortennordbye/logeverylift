/**
 * Database Client Configuration
 *
 * This file initializes the Drizzle ORM client with a PostgreSQL connection pool.
 * The connection string is read from the DATABASE_URL environment variable.
 *
 * Connection pooling ensures efficient database connection management across
 * multiple concurrent requests in production environments.
 */

import { env } from "@/lib/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Initialize Drizzle ORM with schema for relational queries
export const db = drizzle({ client: pool, schema });

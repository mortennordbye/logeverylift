/**
 * Readiness Check Endpoint (Readiness Probe)
 *
 * Advanced health check that verifies the application is ready to serve traffic.
 * Tests database connectivity to ensure the app can handle real requests.
 *
 * Used by Kubernetes readiness probes to determine if a pod should receive traffic.
 * If this fails, the pod is removed from the service load balancer until it recovers.
 *
 * Checks performed:
 * 1. Database connection (executes simple SELECT 1 query)
 * 2. Query timeout handling (5 second max)
 *
 * Kubernetes Configuration:
 * ```yaml
 * readinessProbe:
 *   httpGet:
 *     path: /api/ready
 *     port: 3000
 *   initialDelaySeconds: 15
 *   failureThreshold: 3
 *   periodSeconds: 5
 * ```
 *
 * Returns:
 * - 200 OK: Application is ready (database connected)
 * - 503 Service Unavailable: Application not ready (database unreachable)
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test database connectivity with a simple query
    // Timeout after 5 seconds to prevent hanging probes
    const queryPromise = db.execute(sql`SELECT 1`);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database query timeout")), 5000),
    );

    await Promise.race([queryPromise, timeoutPromise]);

    // Database is reachable
    return NextResponse.json(
      {
        status: "ready",
        checks: {
          database: "connected",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    // Database is unreachable or query failed
    console.error("Readiness check failed:", error);

    return NextResponse.json(
      {
        status: "not_ready",
        checks: {
          database: "disconnected",
        },
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

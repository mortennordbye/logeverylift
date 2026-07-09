/**
 * Health Check Endpoint (Liveness Probe)
 *
 * Basic health check that verifies the application process is running.
 * Used by Kubernetes liveness probes to detect if a pod needs restarting.
 *
 * This endpoint should respond quickly (<100ms) and not perform heavy operations.
 * It simply confirms the Next.js server is alive and can handle requests.
 *
 * Kubernetes Configuration:
 * ```yaml
 * livenessProbe:
 *   httpGet:
 *     path: /api/health
 *     port: 3000
 *   failureThreshold: 3
 *   periodSeconds: 10
 * ```
 *
 * Returns:
 * - 200 OK: Application is healthy
 * - Response body: { status: "ok", timestamp: ISO timestamp }
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

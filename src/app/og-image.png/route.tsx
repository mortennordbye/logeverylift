import { SHARE_IMAGE } from "@/lib/share-metadata";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The link-preview image (see shareMetadata). Rendered once at build time and
// served as a static PNG.
export async function GET() {
  const icon = await readFile(join(process.cwd(), "public/icon-512x512.png"));
  const iconSrc = `data:image/png;base64,${icon.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#000000",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> only */}
          <img src={iconSrc} width={112} height={112} style={{ borderRadius: 26 }} alt="" />
          <div style={{ fontSize: 52, fontWeight: 700 }}>LogEveryLift</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 56,
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          <div>Log every lift.</div>
          <div style={{ color: "#a3a3a3" }}>Know the next one.</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 34, color: "#d4d4d4" }}>
          logeverylift.com
        </div>
      </div>
    ),
    { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height },
  );
}

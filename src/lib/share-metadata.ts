import { env } from "@/lib/env";
import type { Metadata } from "next";
import { connection } from "next/server";

export const SHARE_IMAGE = { path: "/og-image.png", width: 1200, height: 630 } as const;

/**
 * Metadata for the public pages a pasted link ends up on (`/` redirects
 * logged-out visitors to /welcome, deep links to /login), so Slack, iMessage
 * and the rest show a proper card.
 *
 * Link previews need absolute URLs, and the public origin is only known at
 * runtime: the image build has no BETTER_AUTH_URL, so metadata resolved
 * during prerender would point at localhost. connection() defers this to the
 * request. Next renders metadata into <head> before streaming for known
 * preview bots (Slackbot, facebookexternalhit, Twitterbot and others).
 */
export async function shareMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Promise<Metadata> {
  await connection();
  return {
    metadataBase: new URL(env.BETTER_AUTH_URL),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "LogEveryLift",
      locale: "en_US",
      url: path,
      title,
      description,
      images: [
        {
          url: SHARE_IMAGE.path,
          width: SHARE_IMAGE.width,
          height: SHARE_IMAGE.height,
          alt: "LogEveryLift. Log every lift, know the next one",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE.path],
    },
  };
}

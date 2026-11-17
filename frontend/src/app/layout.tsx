import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";

import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pixel face for the 8-bit CTA buttons (.retro in globals.css).
const pressStart = Press_Start_2P({
  variable: "--font-retro",
  weight: "400",
  subsets: ["latin"],
});

const SITE_NAME = "RankLens";
const SITE_DESCRIPTION =
  "RankLens shows agencies how ChatGPT, Gemini and other AI engines mention, rank and cite their clients' brands, with a traceable visibility score and white-label reports.";

/** Absolute base for share links (Open Graph, canonical). Falls back to
 * localhost when NEXT_PUBLIC_SITE_URL is unset, empty or not a valid URL,
 * so a missing value can never fail the production build. */
function siteUrl() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL in production so share links resolve to the real domain.
  metadataBase: siteUrl(),
  title: {
    default: "RankLens — AI visibility tracking for agencies",
    template: "%s | RankLens",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "RankLens — AI visibility tracking for agencies",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "RankLens — AI visibility tracking for agencies",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart.variable} theme-marketing h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

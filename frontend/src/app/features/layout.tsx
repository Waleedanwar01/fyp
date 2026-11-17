import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Features",
  description: "Track how AI engines mention, rank and cite your clients' brands, with evidence behind every result and white-label reports.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

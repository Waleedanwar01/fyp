import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "About",
  description: "RankLens helps agencies measure and improve how their clients appear in AI-generated answers.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

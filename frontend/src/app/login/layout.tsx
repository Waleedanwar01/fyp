import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your RankLens agency workspace.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "How it works",
  description: "See how RankLens runs your prompts against real AI engines, detects brand mentions and turns them into a visibility score.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

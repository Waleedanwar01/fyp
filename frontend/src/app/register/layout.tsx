import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Create your account",
  description: "Create an RankLens agency account and start tracking AI visibility for your clients.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

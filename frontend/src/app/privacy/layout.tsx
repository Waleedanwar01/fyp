import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How RankLens collects, uses and protects your data.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

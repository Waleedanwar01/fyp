import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that govern your use of RankLens.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

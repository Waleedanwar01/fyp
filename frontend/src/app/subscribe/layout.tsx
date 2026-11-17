import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Activate your plan",
  description: "Finish setting up your RankLens subscription.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

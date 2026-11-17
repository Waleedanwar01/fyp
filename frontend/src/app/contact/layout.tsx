import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to the RankLens team about plans, onboarding or support.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

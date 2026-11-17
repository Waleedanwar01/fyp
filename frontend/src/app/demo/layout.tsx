import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Live demo",
  description: "Try RankLens's AI visibility tracking with an interactive demo, no sign-up needed.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

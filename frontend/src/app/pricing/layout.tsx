import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple monthly or yearly plans for agencies of every size. Compare prompt runs, client workspaces and support.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

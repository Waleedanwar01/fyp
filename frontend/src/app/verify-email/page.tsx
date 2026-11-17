import type { Metadata } from "next";
import { Suspense } from "react";

import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email address to activate your RankLens account.",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}

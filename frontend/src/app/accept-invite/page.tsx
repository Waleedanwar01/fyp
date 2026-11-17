import type { Metadata } from "next";
import { Suspense } from "react";

import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Join your agency's RankLens workspace.",
  robots: { index: false, follow: false },
};

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}

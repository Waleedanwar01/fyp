"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { useAuth } from "@/lib/auth-context";
import { extractErrorMessage } from "@/lib/api";

type Status = "verifying" | "success" | "error";

export function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  const { verifyEmail } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<Status>(uid && token ? "verifying" : "error");
  const [errorMessage, setErrorMessage] = useState("This verification link is missing or malformed.");
  const hasRun = useRef(false);

  useEffect(() => {
    if (!uid || !token || hasRun.current) return;
    hasRun.current = true;

    verifyEmail(uid, token)
      .then(() => {
        setStatus("success");
        router.push("/dashboard");
      })
      .catch((error) => {
        setErrorMessage(extractErrorMessage(error));
        setStatus("error");
      });
  }, [uid, token, verifyEmail, router]);

  if (status === "verifying" || status === "success") {
    return (
      <AuthCard title="Verifying your email" description="One moment while we confirm your account.">
        <p className="text-center text-sm text-muted-foreground">
          {status === "success" ? "Verified! Taking you to your dashboard…" : "Verifying…"}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verification failed" description={errorMessage}>
      <Link href="/resend-verification" className="text-center text-sm font-medium underline underline-offset-4">
        Request a new verification link
      </Link>
    </AuthCard>
  );
}

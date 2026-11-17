"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button as BitButton } from "@/components/ui/8bit-button";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth-context";
import { extractErrorMessage } from "@/lib/api";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation";

export function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  const { acceptInvite } = useAuth();
  const router = useRouter();

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  if (!uid || !token) {
    return (
      <AuthCard title="Invalid invite link" description="This invite link is missing or malformed.">
        <Link href="/login" className="text-center text-sm font-medium underline underline-offset-4">
          Back to log in
        </Link>
      </AuthCard>
    );
  }

  const onSubmit = async (data: ResetPasswordInput) => {
    setFormError(null);
    try {
      await acceptInvite(uid, token, data.newPassword);
      router.push("/dashboard");
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  return (
    <AuthCard title="Accept your invite" description="Set a password to join your team on RankLens.">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField label="Password" htmlFor="newPassword" error={errors.newPassword?.message}>
          <PasswordInput id="newPassword" autoComplete="new-password" {...register("newPassword")} />
        </FormField>
        <FormField label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <BitButton type="submit" disabled={isSubmitting} className="mt-3 w-full h-11">
          {isSubmitting ? "Joining…" : "Accept & join"}
        </BitButton>
      </form>
    </AuthCard>
  );
}

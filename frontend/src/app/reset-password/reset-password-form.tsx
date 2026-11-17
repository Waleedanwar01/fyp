"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button as BitButton } from "@/components/ui/8bit-button";
import { PasswordInput } from "@/components/ui/password-input";
import { api, extractErrorMessage } from "@/lib/api";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  if (!uid || !token) {
    return (
      <AuthCard title="Invalid reset link" description="This password reset link is missing or malformed.">
        <Link href="/forgot-password" className="text-center text-sm font-medium underline underline-offset-4">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  const onSubmit = async (data: ResetPasswordInput) => {
    setFormError(null);
    try {
      await api.post("/auth/password-reset/confirm/", {
        uid,
        token,
        new_password: data.newPassword,
      });
      setSubmitted(true);
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  if (submitted) {
    return (
      <AuthCard title="Password updated" description="You can now log in with your new password.">
        <Link href="/login" className="text-center text-sm font-medium underline underline-offset-4">
          Back to log in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" description="Choose a new password for your account.">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField label="New password" htmlFor="newPassword" error={errors.newPassword?.message}>
          <PasswordInput id="newPassword" autoComplete="new-password" {...register("newPassword")} />
        </FormField>
        <FormField label="Confirm new password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <BitButton type="submit" disabled={isSubmitting} className="mt-3 w-full h-11">
          {isSubmitting ? "Saving…" : "Save new password"}
        </BitButton>
      </form>
    </AuthCard>
  );
}

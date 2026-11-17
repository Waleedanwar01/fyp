"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button as BitButton } from "@/components/ui/8bit-button";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation";

export default function ResendVerificationPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setFormError(null);
    try {
      await api.post("/auth/resend-verification/", { email: data.email });
      setSubmitted(true);
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  if (submitted) {
    return (
      <AuthCard
        title="Check your email"
        description="If that account still needs verifying, a new link is on its way."
      >
        <Link href="/login" className="text-center text-sm font-medium underline underline-offset-4">
          Back to log in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Resend verification email"
      description="Enter your email and we'll send you a new verification link."
      footer={
        <>
          Already verified?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </FormField>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <BitButton type="submit" disabled={isSubmitting} className="mt-3 w-full h-11">
          {isSubmitting ? "Sending…" : "Send verification link"}
        </BitButton>
      </form>
    </AuthCard>
  );
}

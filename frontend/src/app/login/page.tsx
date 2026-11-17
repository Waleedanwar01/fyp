"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { safeRedirect } from "@/lib/utils";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button as BitButton } from "@/components/ui/8bit-button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth-context";
import { extractErrorMessage, extractErrorWarning } from "@/lib/api";
import { loginSchema, type LoginInput } from "@/lib/validation";

function LoginForm() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = safeRedirect(searchParams.get("redirect"));

  const [formError, setFormError] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace(redirectUrl);
    }
  }, [user, loading, router, redirectUrl]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    setFormError(null);
    setFormWarning(null);
    try {
      await login(data.email, data.password);
      router.push(redirectUrl);
    } catch (error) {
      setFormError(extractErrorMessage(error));
      setFormWarning(extractErrorWarning(error));
    }
  };

  const registerHref = redirectUrl && redirectUrl !== "/dashboard"
    ? `/register?redirect=${encodeURIComponent(redirectUrl)}`
    : "/register";

  return (
    <AuthCard
      title="Log in"
      description="Welcome back to RankLens."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href={registerHref} className="font-medium text-foreground underline underline-offset-4">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </FormField>
        <FormField label="Password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" {...register("password")} />
        </FormField>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        {formWarning && <p className="text-sm text-amber-600">{formWarning}</p>}
        <BitButton type="submit" disabled={isSubmitting} className="mt-3 w-full h-11">
          {isSubmitting ? "Logging in…" : "Log in"}
        </BitButton>
        <div className="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="underline underline-offset-4">
            Forgot your password?
          </Link>
          <Link href="/resend-verification" className="underline underline-offset-4">
            Need to verify your email?
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

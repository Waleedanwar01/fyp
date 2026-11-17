"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Shield, Sparkles, ArrowRight, Mail } from "lucide-react";

import { safeRedirect } from "@/lib/utils";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Button as BitButton } from "@/components/ui/8bit-button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth-context";
import { extractErrorMessage } from "@/lib/api";
import { registerSchema, type RegisterInput } from "@/lib/validation";

const FREE_PERKS = [
  "Instant access to interactive live demo sandbox",
  "Explore multi-model prompt analysis workflows",
  "Browse white-label client reporting templates",
  "Upgrade to live dashboard monitoring anytime",
];

function RegisterForm() {
  const { user, loading, register: registerAccount } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = safeRedirect(searchParams.get("redirect"));

  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace(redirectUrl);
    }
  }, [user, loading, router, redirectUrl]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { agencyName: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: RegisterInput) => {
    setFormError(null);
    try {
      await registerAccount(data.agencyName, data.email, data.password, data.plan || "starter");
      setSubmitted(true);
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  const loginHref = redirectUrl && redirectUrl !== "/dashboard"
    ? `/login?redirect=${encodeURIComponent(redirectUrl)}`
    : "/login";

  if (submitted) {
    return (
      <AuthCard
        title="Check your inbox"
        description="We've sent a verification link to activate your free agency account."
      >
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-300 text-xs flex items-start gap-3">
          <Mail className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-emerald-200 text-sm">Account created successfully</p>
            <p className="text-muted-foreground leading-relaxed">
              Click the link in the verification email to activate your account. Once verified, you can explore the
              platform, access the sandbox demo, and choose a subscription plan whenever you are ready.
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground text-center">
            Didn&apos;t receive the email?{" "}
            <Link href="/resend-verification" className="font-medium text-primary hover:underline">
              Resend verification email
            </Link>
          </p>

          <Link href={loginHref} className="block">
            <Button variant="outline" className="w-full">
              Proceed to Sign In
            </Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create Free Agency Account"
      description="Start exploring RankLens in seconds. No credit card required."
      footer={
        <div className="flex flex-col gap-2 text-center text-xs text-muted-foreground">
          <div>
            Already have an account?{" "}
            <Link href={loginHref} className="font-medium text-foreground hover:text-primary underline underline-offset-4">
              Sign in
            </Link>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground/80">
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            <span>Free exploration account • Dashboard access unlocked upon subscription</span>
          </div>
        </div>
      }
    >
      <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary mb-2">
          <Sparkles className="h-3.5 w-3.5" /> Included Free
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
          {FREE_PERKS.map((perk) => (
            <li key={perk} className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField label="Agency name" htmlFor="agencyName" error={errors.agencyName?.message}>
          <Input
            id="agencyName"
            placeholder="e.g. Apex Media Agency"
            autoComplete="organization"
            {...register("agencyName")}
          />
        </FormField>

        <FormField label="Work email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            placeholder="name@agency.com"
            autoComplete="email"
            {...register("email")}
          />
        </FormField>

        <FormField label="Password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            {...register("password")}
          />
        </FormField>

        <FormField label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
          <PasswordInput
            id="confirmPassword"
            placeholder="Re-enter password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </FormField>

        {formError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            {formError}
          </div>
        )}

        <BitButton type="submit" disabled={isSubmitting} className="mt-3 w-full group h-11">
          {isSubmitting ? (
            "Creating your account…"
          ) : (
            <span className="flex items-center justify-center gap-2">
              Create Free Account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </BitButton>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Bell,
  Check,
  CheckCircle2,
  Crown,
  KeyRound,
  Lock,
  Mail,
  Save,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { api, extractErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export default function AccountPage() {
  const { user } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Client-side notification preference toggles
  const [emailDigest, setEmailDigest] = useState(true);
  const [scheduleAlerts, setScheduleAlerts] = useState(true);
  const [usageAlerts, setUsageAlerts] = useState(true);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const watchedNewPassword = watch("newPassword") || "";

  // Password strength signals
  const hasMinLength = watchedNewPassword.length >= 8;
  const hasMixedCase = /[a-z]/.test(watchedNewPassword) && /[A-Z]/.test(watchedNewPassword);
  const hasNumberOrSpecial = /[0-9!@#$%^&*]/.test(watchedNewPassword);
  const strengthCount = [hasMinLength, hasMixedCase, hasNumberOrSpecial].filter(Boolean).length;

  const onSubmit = async (data: ChangePasswordInput) => {
    setFormError(null);
    setSuccess(false);
    try {
      await api.post("/auth/change-password/", {
        old_password: data.oldPassword,
        new_password: data.newPassword,
      });
      setSuccess(true);
      reset();
      setTimeout(() => setSuccess(false), 4000);
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  const handleSavePreferences = () => {
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 3000);
  };

  if (!user) return <AppShell>{null}</AppShell>;

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Header Profile HUD */}
        <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/80 to-primary text-white font-bold text-xl shadow-md border border-primary/30">
              {initial}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{user.email}</h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold capitalize text-primary">
                  {user.role === "admin" ? <Crown className="size-3" /> : <Shield className="size-3" />}
                  {user.role}
                </span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Member of <span className="font-semibold text-foreground">{user.agency?.name ?? "Agency Workspace"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border/80 bg-secondary/25 px-3 py-1.5 text-xs text-muted-foreground self-start sm:self-auto">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            <span>JWT Session Active (24h Auto-Rotation)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Column: Security & Password */}
          <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <CardTitle className="text-base font-semibold">Change Password</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Update the master password used to authenticate your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
                <FormField label="Current Password" htmlFor="oldPassword" error={errors.oldPassword?.message} required>
                  <PasswordInput
                    id="oldPassword"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="rounded-xl"
                    {...register("oldPassword")}
                  />
                </FormField>

                <FormField label="New Password" htmlFor="newPassword" error={errors.newPassword?.message} required>
                  <PasswordInput
                    id="newPassword"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    className="rounded-xl"
                    {...register("newPassword")}
                  />
                </FormField>

                {/* Password Strength Checklist */}
                {watchedNewPassword && (
                  <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-secondary/20 p-3 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-foreground">
                      <span>Password Strength</span>
                      <span className={cn(
                        "font-bold",
                        strengthCount === 3 ? "text-emerald-600" : strengthCount === 2 ? "text-amber-600" : "text-destructive"
                      )}>
                        {strengthCount === 3 ? "Strong" : strengthCount === 2 ? "Medium" : "Weak"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", hasMinLength ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className={hasMinLength ? "text-foreground" : "text-muted-foreground"}>8+ characters</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", hasMixedCase ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className={hasMixedCase ? "text-foreground" : "text-muted-foreground"}>Upper & lowercase letters</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", hasNumberOrSpecial ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className={hasNumberOrSpecial ? "text-foreground" : "text-muted-foreground"}>Number or special character</span>
                    </div>
                  </div>
                )}

                <FormField
                  label="Confirm New Password"
                  htmlFor="confirmPassword"
                  error={errors.confirmPassword?.message}
                  required
                >
                  <PasswordInput
                    id="confirmPassword"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="rounded-xl"
                    {...register("confirmPassword")}
                  />
                </FormField>

                {formError && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
                    {formError}
                  </p>
                )}
                {success && (
                  <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    <span>Password updated successfully!</span>
                  </p>
                )}

                <Button type="submit" disabled={isSubmitting} className="mt-2 w-full gap-2 rounded-xl font-semibold">
                  <KeyRound className="size-4" />
                  <span>{isSubmitting ? "Updating password…" : "Update Password"}</span>
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Right Column: Account Details & Preferences */}
          <div className="flex flex-col gap-6">
            {/* Account Details Card */}
            <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <User className="size-4 text-primary" />
                  <CardTitle className="text-base font-semibold">Account & Tenant Details</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Your identity metadata and authentication configuration.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-xs">
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3">
                  <span className="text-muted-foreground">Registered Email</span>
                  <span className="font-semibold text-foreground">{user.email}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3">
                  <span className="text-muted-foreground">Assigned Role</span>
                  <span className="font-semibold capitalize text-primary">{user.role}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3">
                  <span className="text-muted-foreground">Agency Tenant</span>
                  <span className="font-semibold text-foreground">{user.agency?.name ?? "Acme Marketing"}</span>
                </div>
              </CardContent>
            </Card>

            {/* Notification Preferences Card */}
            <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="size-4 text-primary" />
                    <CardTitle className="text-base font-semibold">Notification Preferences</CardTitle>
                  </div>
                  {prefsSaved && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3" />
                      Saved
                    </span>
                  )}
                </div>
                <CardDescription className="text-xs">
                  Manage automated email delivery alerts and digest frequency.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-xs">
                <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3 cursor-pointer transition hover:bg-secondary/30">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-foreground">Weekly AI Audit Digest</span>
                    <span className="text-[11px] text-muted-foreground">Receive weekly Visibility Score summaries</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={emailDigest}
                    onChange={(e) => setEmailDigest(e.target.checked)}
                    className="size-4 rounded border-border text-primary focus:ring-primary"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3 cursor-pointer transition hover:bg-secondary/30">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-foreground">Scheduled Audit Notifications</span>
                    <span className="text-[11px] text-muted-foreground">Notify when automated prompt batches finish</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={scheduleAlerts}
                    onChange={(e) => setScheduleAlerts(e.target.checked)}
                    className="size-4 rounded border-border text-primary focus:ring-primary"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/15 p-3 cursor-pointer transition hover:bg-secondary/30">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-foreground">Low Prompt Run Balance Alerts</span>
                    <span className="text-[11px] text-muted-foreground">Alert when monthly prompt allowance hits 10%</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={usageAlerts}
                    onChange={(e) => setUsageAlerts(e.target.checked)}
                    className="size-4 rounded border-border text-primary focus:ring-primary"
                  />
                </label>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSavePreferences}
                  className="mt-1 gap-2 rounded-xl text-xs font-semibold"
                >
                  <Save className="size-3.5" />
                  <span>Save Notification Preferences</span>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

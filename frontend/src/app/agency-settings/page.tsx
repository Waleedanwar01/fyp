"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BellRing,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Laptop,
  Lock,
  Mail,
  MapPin,
  Palette,
  Phone,
  Play,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { useAuth, type Agency } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  SOUND_PRESETS,
  getNotificationSoundSetting,
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
  setNotificationSoundSetting,
  getNotificationVolume,
  setNotificationVolume,
  type NotificationSoundType,
} from "@/lib/notification-sounds";

const agencySettingsSchema = z.object({
  name: z.string().min(2, "Agency name must be at least 2 characters"),
  subdomain: z.string().optional(),
  logo_url: z.string().optional(),
  tagline: z.string().optional(),
  support_email: z.string().email("Invalid email address").optional().or(z.literal("")),
  website_url: z.string().url("Invalid URL").optional().or(z.literal("")),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  location: z.string().optional(),
  report_footer: z.string().optional(),
  primary_color: z.string().optional(),
  accent_color: z.string().optional(),
});
type AgencySettingsInput = z.infer<typeof agencySettingsSchema>;

const COLOR_PRESETS = [
  { name: "Default Sky", primary: "#0284c7", accent: "#38bdf8" },
  { name: "Emerald Growth", primary: "#059669", accent: "#34d399" },
  { name: "Indigo Executive", primary: "#4f46e5", accent: "#818cf8" },
  { name: "Violet Intelligence", primary: "#7c3aed", accent: "#a78bfa" },
  { name: "Amber Authority", primary: "#d97706", accent: "#fbbf24" },
  { name: "Rose Pulse", primary: "#e11d48", accent: "#fb7185" },
];

const TIMEZONE_OPTIONS = [
  { value: "Asia/Karachi", label: "Asia/Karachi (PKT • UTC+05:00)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST • UTC+04:00)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (AST • UTC+03:00)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST • UTC+00:00)" },
  { value: "America/New_York", label: "America/New_York (EST/EDT • UTC-05:00)" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT • UTC-06:00)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST/PDT • UTC-08:00)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];

export default function AgencySettingsPage() {
  const { user, updateAgency } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification Audio Settings State
  const [selectedSound, setSelectedSound] = useState<NotificationSoundType>("modern_chime");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const canEdit = user?.role === "admin";

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AgencySettingsInput>({
    resolver: zodResolver(agencySettingsSchema),
    defaultValues: {
      name: "",
      subdomain: "",
      logo_url: "",
      tagline: "",
      support_email: "",
      website_url: "",
      phone: "",
      timezone: "Asia/Karachi",
      location: "",
      report_footer: "",
      primary_color: "#0284c7",
      accent_color: "#38bdf8",
    },
  });

  const watchedLogoUrl = watch("logo_url");
  const watchedPrimaryColor = watch("primary_color") || "#0284c7";
  const watchedAccentColor = watch("accent_color") || "#38bdf8";
  const watchedSubdomain = watch("subdomain");
  const watchedName = watch("name");
  const watchedTagline = watch("tagline");
  const watchedFooter = watch("report_footer");

  useEffect(() => {
    setSelectedSound(getNotificationSoundSetting());
    setAudioEnabled(isNotificationSoundEnabled());
    setVolume(getNotificationVolume());
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .get<Agency>("/agencies/me/")
      .then(({ data }) => {
        setAgency(data);
        const config = (data.white_label_config || {}) as Record<string, any>;
        if (config.notification_sound) {
          setSelectedSound(config.notification_sound as NotificationSoundType);
          setNotificationSoundSetting(config.notification_sound as NotificationSoundType);
        }
        reset({
          name: data.name || "",
          subdomain: data.subdomain ?? "",
          logo_url: data.logo_url ?? "",
          tagline: config.tagline ?? "",
          support_email: config.support_email ?? "",
          website_url: config.website_url ?? "",
          phone: config.phone ?? "",
          timezone: config.timezone ?? "Asia/Karachi",
          location: config.location ?? "",
          report_footer: config.report_footer ?? `Confidential & Proprietary AI Visibility Audit • ${data.name}`,
          primary_color: config.primary_color ?? "#0284c7",
          accent_color: config.accent_color ?? "#38bdf8",
        });
      })
      .catch((error) => setLoadError(extractErrorMessage(error)));
  }, [user, reset]);

  // Handle local image file upload & convert to base64
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Please upload an image smaller than 5MB.");
      return;
    }

    // Resize in the browser before saving: the server keeps logos under
    // 600 KB, and 512px is plenty for the sidebar, tab icon and PDF header.
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        let result = canvas.toDataURL("image/png");
        if (result.length > 780_000) result = canvas.toDataURL("image/webp", 0.9);
        setLogoPreviewError(false);
        setValue("logo_url", result, { shouldDirty: true });
      };
      img.onerror = () => alert("That file couldn't be read as an image. Try a PNG, JPG, WebP or SVG.");
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setValue("logo_url", "", { shouldDirty: true });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSelectSound = (sound: NotificationSoundType) => {
    setSelectedSound(sound);
    setNotificationSoundSetting(sound);
    playNotificationSound(sound);
  };

  const handleToggleAudio = (enabled: boolean) => {
    setAudioEnabled(enabled);
    setNotificationSoundEnabled(enabled);
    if (enabled) {
      playNotificationSound(selectedSound);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setNotificationVolume(newVol);
  };

  const handlePreviewSound = (sound: NotificationSoundType, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayingPreview(sound);
    playNotificationSound(sound);
    setTimeout(() => setPlayingPreview(null), 800);
  };

  const handleSendTestNotification = async () => {
    setTestSending(true);
    setTestSuccess(false);
    try {
      const { data } = await api.post("/notifications/test/", {});
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("avtr:toast-notification", {
            detail: data || {
              id: "test-" + Date.now(),
              type: "schedule_started",
              message: "Test Alert: Automated AI search visibility benchmark completed for your client.",
            },
          })
        );
      }
      setTestSuccess(true);
      setTimeout(() => setTestSuccess(false), 4000);
    } catch {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("avtr:toast-notification", {
            detail: {
              id: "test-" + Date.now(),
              type: "schedule_started",
              message: "Test Alert: Automated AI search audit benchmark completed successfully.",
            },
          })
        );
      }
      setTestSuccess(true);
      setTimeout(() => setTestSuccess(false), 4000);
    } finally {
      setTestSending(false);
    }
  };

  const onSubmit = async (data: AgencySettingsInput) => {
    setFormError(null);
    setSuccess(false);
    try {
      const white_label_config = {
        ...(agency?.white_label_config || {}),
        tagline: data.tagline || undefined,
        support_email: data.support_email || undefined,
        website_url: data.website_url || undefined,
        phone: data.phone || undefined,
        timezone: data.timezone || undefined,
        location: data.location || undefined,
        report_footer: data.report_footer || undefined,
        primary_color: data.primary_color || "#0284c7",
        accent_color: data.accent_color || "#38bdf8",
        notification_sound: selectedSound,
      };

      const { data: updated } = await api.patch<Agency>("/agencies/me/", {
        name: data.name,
        subdomain: data.subdomain || null,
        logo_url: data.logo_url ?? "",
        white_label_config,
      });

      setAgency(updated);
      updateAgency(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  const handleCopyId = () => {
    if (!agency?.id) return;
    navigator.clipboard.writeText(agency.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (!user) return <AppShell>{null}</AppShell>;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* Header HUD Banner */}
        <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-secondary/15 p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-xs">
              <Building2 className="size-7" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {agency?.name || "Agency Workspace Settings"}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                  <ShieldCheck className="size-3" />
                  <span>Tenant Isolated RLS</span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Configure your agency branding, upload official logos, white-label client PDF reports, alert chimes, and domain settings.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:self-start">
            <button
              type="button"
              onClick={handleCopyId}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-xs font-mono text-muted-foreground transition hover:bg-secondary hover:text-foreground shadow-2xs"
              title="Click to copy Agency Tenant ID"
            >
              {copiedId ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              <span>Tenant ID: {agency?.id ? `${agency.id.slice(0, 8)}...` : "Loading"}</span>
            </button>
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-medium text-destructive">
            {loadError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left 7 Columns: Form Controls */}
            <div className="flex flex-col gap-6 lg:col-span-7">
              {/* Card 1: Logo Management & Agency Identity */}
              <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
                <CardHeader className="pb-4 border-b border-border/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <ImageIcon className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">Agency Identity &amp; Logo</CardTitle>
                        <CardDescription className="text-xs">
                          Your official agency logo and basic profile details.
                        </CardDescription>
                      </div>
                    </div>
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      Header &amp; Reports
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-5 pt-5">
                  {/* Logo Upload & Preview Hub */}
                  <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-secondary/15 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">Agency Logo</span>
                        <span className="rounded-full bg-secondary px-2 py-0.2 text-[10px] font-medium text-muted-foreground">
                          Optional
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">PNG, SVG, or WebP (Max 5MB)</span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      {/* Logo Preview Canvas */}
                      <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xs">
                        {watchedLogoUrl && !logoPreviewError ? (
                          <img
                            src={watchedLogoUrl}
                            alt="Agency Logo"
                            onError={() => setLogoPreviewError(true)}
                            className="size-full object-contain p-2"
                          />
                        ) : (
                          <div
                            className="flex size-full items-center justify-center font-bold text-white text-xl"
                            style={{ backgroundColor: watchedPrimaryColor }}
                          >
                            {(watchedName || "A").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Upload & Action Controls */}
                      <div className="flex flex-col gap-2 flex-1 w-full">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            onChange={handleFileUpload}
                            disabled={!canEdit}
                            className="hidden"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!canEdit}
                            onClick={() => fileInputRef.current?.click()}
                            className="h-8.5 rounded-xl text-xs font-semibold gap-1.5"
                          >
                            <Upload className="size-3.5 text-primary" />
                            <span>Upload Image File</span>
                          </Button>

                          {watchedLogoUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit}
                              onClick={handleRemoveLogo}
                              className="h-8.5 rounded-xl text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                            >
                              <Trash2 className="size-3.5" />
                              <span>Remove</span>
                            </Button>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            placeholder="Or paste direct logo URL (https://.../logo.png)"
                            value={watchedLogoUrl || ""}
                            onChange={(e) => {
                              setLogoPreviewError(false);
                              setValue("logo_url", e.target.value, { shouldDirty: true });
                            }}
                            disabled={!canEdit}
                            className="h-8 rounded-xl text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Core Agency Fields */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      label="Agency Name"
                      htmlFor="name"
                      error={errors.name?.message}
                      required
                    >
                      <Input
                        id="name"
                        disabled={!canEdit}
                        placeholder="e.g. Barcha Digital"
                        className="rounded-xl"
                        {...register("name")}
                      />
                    </FormField>

                    <FormField
                      label="Tagline / Industry Focus"
                      htmlFor="tagline"
                      error={errors.tagline?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <Input
                        id="tagline"
                        disabled={!canEdit}
                        placeholder="e.g. AI Search Optimization & Visibility"
                        className="rounded-xl"
                        {...register("tagline")}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      label="Support / Client Contact Email"
                      htmlFor="support_email"
                      error={errors.support_email?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          id="support_email"
                          type="email"
                          disabled={!canEdit}
                          placeholder="support@barchadigital.com"
                          className="rounded-xl pl-9"
                          {...register("support_email")}
                        />
                        <Mail className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
                      </div>
                    </FormField>

                    <FormField
                      label="Agency Website URL"
                      htmlFor="website_url"
                      error={errors.website_url?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          id="website_url"
                          disabled={!canEdit}
                          placeholder="https://barchadigital.com"
                          className="rounded-xl pl-9"
                          {...register("website_url")}
                        />
                        <Globe className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
                      </div>
                    </FormField>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      label="Contact Phone / WhatsApp"
                      htmlFor="phone"
                      error={errors.phone?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          id="phone"
                          disabled={!canEdit}
                          placeholder="+92 300 1234567"
                          className="rounded-xl pl-9"
                          {...register("phone")}
                        />
                        <Phone className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
                      </div>
                    </FormField>

                    <FormField
                      label="Timezone & Reporting Schedule"
                      htmlFor="timezone"
                      error={errors.timezone?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <select
                        id="timezone"
                        disabled={!canEdit}
                        {...register("timezone")}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: White-Label Branding & Reports */}
              <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
                <CardHeader className="pb-4 border-b border-border/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Palette className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">White-Label Branding &amp; Colors</CardTitle>
                        <CardDescription className="text-xs">
                          Customize your agency colors, client subdomain, and PDF report styling.
                        </CardDescription>
                      </div>
                    </div>
                    <span className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary font-mono">
                      PDF White-Label
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-5 pt-5">
                  {/* Color Pickers & Presets */}
                  <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-secondary/15 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">Brand Color Palette</span>
                      <span className="text-[11px] text-muted-foreground">Applied to client exports &amp; UI</span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
                        <input
                          type="color"
                          disabled={!canEdit}
                          value={watchedPrimaryColor}
                          onChange={(e) => setValue("primary_color", e.target.value, { shouldDirty: true })}
                          className="size-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-foreground">Primary Color</span>
                            <span className="rounded-full bg-primary/15 text-primary text-[9px] font-bold px-1.5 py-0.2">Required</span>
                          </div>
                          <span className="font-mono text-[11px] text-muted-foreground uppercase">{watchedPrimaryColor}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
                        <input
                          type="color"
                          disabled={!canEdit}
                          value={watchedAccentColor}
                          onChange={(e) => setValue("accent_color", e.target.value, { shouldDirty: true })}
                          className="size-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-foreground">Accent Highlight</span>
                            <span className="rounded-full bg-secondary text-muted-foreground text-[9px] font-medium px-1.5 py-0.2">Optional</span>
                          </div>
                          <span className="font-mono text-[11px] text-muted-foreground uppercase">{watchedAccentColor}</span>
                        </div>
                      </div>
                    </div>

                    {/* Presets */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10.5px] font-medium text-muted-foreground mr-1">Presets:</span>
                      {COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.name}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            setValue("primary_color", preset.primary, { shouldDirty: true });
                            setValue("accent_color", preset.accent, { shouldDirty: true });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-2.5 py-1 text-[10.5px] font-medium transition hover:border-primary hover:bg-secondary/40 shadow-2xs"
                        >
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: preset.primary }} />
                          <span>{preset.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      label="Custom Subdomain"
                      htmlFor="subdomain"
                      error={errors.subdomain?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          id="subdomain"
                          disabled={!canEdit}
                          placeholder="acme"
                          className="rounded-xl pr-24 font-mono text-xs lowercase"
                          {...register("subdomain")}
                        />
                        <span className="pointer-events-none absolute right-3 text-xs font-mono text-muted-foreground">
                          .ranklens.app
                        </span>
                      </div>
                    </FormField>

                    <FormField
                      label="Report Legal / Footer Disclaimer"
                      htmlFor="report_footer"
                      error={errors.report_footer?.message}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">(Optional)</span>
                      </div>
                      <Input
                        id="report_footer"
                        disabled={!canEdit}
                        placeholder="Confidential & Proprietary AI Visibility Audit"
                        className="rounded-xl"
                        {...register("report_footer")}
                      />
                    </FormField>
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Notification Sounds & Audio Chimes */}
              <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
                <CardHeader className="pb-4 border-b border-border/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <BellRing className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">Notification Sounds &amp; Alert Chimes</CardTitle>
                        <CardDescription className="text-xs">
                          Select the sound played when automated schedule audits complete.
                        </CardDescription>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleAudio(!audioEnabled)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all cursor-pointer shadow-2xs",
                        audioEnabled
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {audioEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                      <span>{audioEnabled ? "Audio ON" : "Muted"}</span>
                    </button>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4 pt-5">
                  {/* Sound Presets Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SOUND_PRESETS.map((preset) => {
                      const isSelected = selectedSound === preset.id;
                      const isPreviewing = playingPreview === preset.id;

                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleSelectSound(preset.id)}
                          className={cn(
                            "flex items-center justify-between rounded-xl border p-3 cursor-pointer transition-all",
                            isSelected
                              ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                              : "border-border/70 bg-card hover:border-border hover:bg-secondary/30"
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-lg font-bold text-xs transition-colors",
                                isSelected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                              )}
                            >
                              {isSelected ? <Check className="size-3.5" /> : <Volume2 className="size-3" />}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className={cn("text-xs font-bold truncate", isSelected ? "text-primary" : "text-foreground")}>
                                {preset.label}
                              </span>
                              <span className="text-[10.5px] text-muted-foreground truncate">
                                {preset.description}
                              </span>
                            </div>
                          </div>

                          {preset.id !== "none" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => handlePreviewSound(preset.id, e)}
                              className={cn(
                                "h-7 px-2 text-[11px] font-semibold shrink-0 rounded-lg gap-1",
                                isPreviewing ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                              )}
                              title={`Preview ${preset.label}`}
                            >
                              <Play className="size-2.5 fill-current" />
                              <span>Play</span>
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Volume Slider & Test Action Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/15 p-3.5">
                    <div className="flex items-center gap-3">
                      <Volume2 className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">Alert Volume:</span>
                          <span className="text-xs font-mono font-bold text-primary">{Math.round(volume * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={volume}
                          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                          className="h-1.5 w-32 sm:w-44 cursor-pointer accent-primary rounded-lg bg-secondary"
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleSendTestNotification}
                      disabled={testSending}
                      className="h-8.5 px-3 text-xs font-semibold rounded-xl gap-1.5 shrink-0 shadow-2xs"
                    >
                      <Send className="size-3 text-primary" />
                      <span>{testSending ? "Sending Alert…" : "Test Notification & Chime"}</span>
                    </Button>
                  </div>

                  {testSuccess && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in-0">
                      <CheckCircle2 className="size-4 shrink-0" />
                      <span>Test chime played and notification dispatched to your dashboard!</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right 5 Columns: Live Preview & System Security */}
            <div className="flex flex-col gap-6 lg:col-span-5">
              {/* Live White-Label Client Portal Preview */}
              <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs overflow-hidden sticky top-6">
                <CardHeader className="pb-3 border-b border-border/60 bg-secondary/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Laptop className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold">Live White-Label Preview</CardTitle>
                    </div>
                    <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary font-mono">
                      Client View
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="p-4 flex flex-col gap-4">
                  {/* Sample Mock Header & Report Page */}
                  <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background p-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-border/60">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {watchedLogoUrl && !logoPreviewError ? (
                          <img
                            src={watchedLogoUrl}
                            alt="Agency Logo"
                            onError={() => setLogoPreviewError(true)}
                            className="h-8 max-w-[130px] object-contain shrink-0"
                          />
                        ) : (
                          <div
                            className="flex size-8 shrink-0 items-center justify-center rounded-xl text-white font-bold text-xs shadow-2xs"
                            style={{ backgroundColor: watchedPrimaryColor }}
                          >
                            {(watchedName || "A").slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold leading-tight text-foreground truncate">
                            {watchedName || "Your Agency Name"}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {watchedTagline || "AI Visibility Intelligence"}
                          </span>
                        </div>
                      </div>

                      <span
                        className="rounded-md px-2 py-0.5 text-[9.5px] font-bold text-white shadow-2xs shrink-0"
                        style={{ backgroundColor: watchedPrimaryColor }}
                      >
                        Client Report
                      </span>
                    </div>

                    <div className="rounded-lg border border-dashed border-border/80 p-3 text-center bg-secondary/10 flex flex-col gap-1">
                      <span className="text-xs font-bold text-foreground">AI Search Engine Visibility Matrix</span>
                      <span className="text-[10.5px] text-muted-foreground">Google Gemini • OpenAI ChatGPT • Perplexity</span>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[9.5px] text-muted-foreground font-mono">
                      <span className="truncate max-w-[180px]">
                        {watchedFooter || `Prepared by ${watchedName || "Agency"}`}
                      </span>
                      <span>Page 1 of 4</span>
                    </div>
                  </div>

                  {/* Subdomain URL Pill */}
                  <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 text-xs flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Globe className="size-3.5 text-primary" />
                      <span>Custom Subdomain URL:</span>
                    </div>
                    <code className="rounded-lg bg-background px-2.5 py-1.5 text-[11px] font-mono text-primary border border-border/60 select-all">
                      https://{watchedSubdomain || "your-agency"}.ranklens.app
                    </code>
                  </div>

                  {/* Security & Multi-Tenancy Specs */}
                  <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-secondary/15 p-3 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground pb-1 border-b border-border/60">
                      <ShieldCheck className="size-3.5 text-emerald-500" />
                      <span>Tenant Security &amp; Compliance</span>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted-foreground">PostgreSQL RLS:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Enforced &amp; Active</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Multi-Tenant Vault:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Isolated</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">White-Label Status:</span>
                      <span className="font-semibold text-primary font-mono">Active</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2">
              {success && (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  <span>Agency settings saved successfully!</span>
                </div>
              )}
              {formError && (
                <p className="text-xs font-medium text-destructive">{formError}</p>
              )}
              {!success && !formError && (
                <p className="text-xs text-muted-foreground">
                  {canEdit
                    ? isDirty
                      ? "You have unsaved changes. Don't forget to save."
                      : "All agency settings are up to date."
                    : "View-only mode (Admin role required to edit)."}
                </p>
              )}
            </div>

            {canEdit && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isDirty || isSubmitting}
                  onClick={() => {
                    if (agency) {
                      const config = (agency.white_label_config || {}) as Record<string, any>;
                      reset({
                        name: agency.name || "",
                        subdomain: agency.subdomain ?? "",
                        logo_url: agency.logo_url ?? "",
                        tagline: config.tagline ?? "",
                        support_email: config.support_email ?? "",
                        website_url: config.website_url ?? "",
                        phone: config.phone ?? "",
                        timezone: config.timezone ?? "Asia/Karachi",
                        location: config.location ?? "",
                        report_footer: config.report_footer ?? "",
                        primary_color: config.primary_color ?? "#0284c7",
                        accent_color: config.accent_color ?? "#38bdf8",
                      });
                    }
                  }}
                  className="rounded-xl text-xs font-semibold gap-1.5 h-9"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Discard</span>
                </Button>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="gap-2 rounded-xl px-5 font-semibold shadow-xs h-9"
                >
                  <Save className="size-4" />
                  <span>{isSubmitting ? "Saving changes…" : "Save Changes"}</span>
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </AppShell>
  );
}

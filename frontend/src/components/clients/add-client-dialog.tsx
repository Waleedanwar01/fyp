"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  Layers,
  MapPin,
  Plus,
  Sparkles,
  Swords,
  Tag,
} from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { LocationPicker } from "@/components/clients/location-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { addClientSchema, type AddClientInput } from "@/lib/validation";
import { cn } from "@/lib/utils";

const toList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const INDUSTRY_PRESETS = [
  "B2B SaaS",
  "Healthcare & MedTech",
  "Fintech & Banking",
  "E-Commerce & Retail",
  "Real Estate",
  "Legal & Corporate",
  "Digital Marketing",
  "Hospitality & Travel",
];

export function AddClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AddClientInput>({
    resolver: zodResolver(addClientSchema),
    defaultValues: {
      name: "",
      industry: "",
      targetLocations: [],
      services: "",
      brandName: "",
      brandAliases: "",
      competitors: "",
    },
  });

  const watchedIndustry = watch("industry");

  const submit = async (data: AddClientInput) => {
    setFormError(null);
    let client: { id: string };
    try {
      const response = await api.post("/clients/", {
        name: data.name,
        industry: data.industry ?? "",
        target_locations: data.targetLocations,
        services: toList(data.services),
      });
      client = response.data;
    } catch (error) {
      setFormError(extractErrorMessage(error));
      return;
    }

    const warnings: string[] = [];
    if (data.brandName?.trim()) {
      try {
        await api.post("/brands/", {
          client: client.id,
          name: data.brandName.trim(),
          aliases: toList(data.brandAliases),
        });
      } catch (error) {
        warnings.push(`Brand: ${extractErrorMessage(error)}`);
      }
    }
    for (const name of toList(data.competitors)) {
      try {
        await api.post("/competitors/", { client: client.id, name, aliases: [] });
      } catch (error) {
        warnings.push(`Competitor "${name}": ${extractErrorMessage(error)}`);
      }
    }

    onCreated();
    if (warnings.length > 0) {
      window.alert(
        `${data.name} was created, but a few details couldn't be saved:\n\n${warnings.join(
          "\n"
        )}\n\nYou can add them from that client's Brand/Competitors buttons.`
      );
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl p-6">
        <DialogHeader className="pb-2 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Building2 className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Onboard New Client Workspace</DialogTitle>
              <DialogDescription className="text-xs">
                Configure client identity, target geography, core brand, and competitive tracking in one place.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(submit)}
          className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-2 pt-2"
          noValidate
        >
          {/* Section 1: Client Overview */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Briefcase className="size-3.5 text-primary" />
              <span>Client & Industry Details</span>
            </div>

            <FormField label="Client / Business Name" htmlFor="add-client-name" error={errors.name?.message} required>
              <Input
                id="add-client-name"
                autoFocus
                placeholder="e.g. Acme Health Corp"
                className="rounded-xl"
                {...register("name")}
              />
            </FormField>

            <FormField label="Industry / Vertical" htmlFor="add-client-industry" error={errors.industry?.message}>
              <div className="flex flex-col gap-2">
                <Input
                  id="add-client-industry"
                  placeholder="e.g. Healthcare & MedTech"
                  className="rounded-xl"
                  {...register("industry")}
                />
                {/* Industry Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] font-medium text-muted-foreground">Quick pick:</span>
                  {INDUSTRY_PRESETS.map((ind) => (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => setValue("industry", ind, { shouldValidate: true })}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition",
                        watchedIndustry === ind
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border/70 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      )}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
            </FormField>
          </div>

          {/* Section 2: Targeting & Services */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <MapPin className="size-3.5 text-primary" />
              <span>Target Locations & Core Services</span>
            </div>

            <FormField
              label="Target Geographic Locations"
              htmlFor="add-client-locations"
              error={errors.targetLocations?.message}
              required
            >
              <Controller
                name="targetLocations"
                control={control}
                render={({ field }) => (
                  <LocationPicker id="add-client-locations" value={field.value} onChange={field.onChange} />
                )}
              />
              <p className="text-[11px] text-muted-foreground">
                Search cities or countries — these pre-fill automated AI search prompts for this client.
              </p>
            </FormField>

            <FormField label="Services Offered" htmlFor="add-client-services" error={errors.services?.message}>
              <Input
                id="add-client-services"
                placeholder="e.g. Cardiology, Telehealth, MRI Diagnostics"
                className="rounded-xl"
                {...register("services")}
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated services — used to categorize and tag buyer-intent prompts.
              </p>
            </FormField>
          </div>

          {/* Section 3: Brand & Competitors */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-secondary/15 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-primary" />
              <span>Tracked Brand & Competitors (Optional)</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Primary Brand Name" htmlFor="add-client-brand-name" error={errors.brandName?.message}>
                <Input
                  id="add-client-brand-name"
                  placeholder="e.g. Acme Health"
                  className="rounded-xl bg-background"
                  {...register("brandName")}
                />
              </FormField>

              <FormField
                label="Brand Aliases & Variations"
                htmlFor="add-client-brand-aliases"
                error={errors.brandAliases?.message}
              >
                <Input
                  id="add-client-brand-aliases"
                  placeholder="Acme, Acme Medical"
                  className="rounded-xl bg-background"
                  {...register("brandAliases")}
                />
              </FormField>
            </div>

            <FormField
              label="Direct Competitors"
              htmlFor="add-client-competitors"
              error={errors.competitors?.message}
            >
              <Input
                id="add-client-competitors"
                placeholder="e.g. VitalCare, HealthFirst, MediClinic"
                className="rounded-xl bg-background"
                {...register("competitors")}
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated competitor brand names to monitor head-to-head in AI visibility audits.
              </p>
            </FormField>
          </div>

          {formError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <p className="font-semibold">{formError}</p>
              {formError.toLowerCase().includes("limit") && (
                <a
                  href="/billing"
                  className="mt-1.5 inline-block font-medium text-primary underline hover:opacity-80"
                >
                  Upgrade subscription plan in Billing &rarr;
                </a>
              )}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2 rounded-xl font-semibold px-5">
              <Plus className="size-4" />
              <span>{isSubmitting ? "Creating Client…" : "Create Client Workspace"}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

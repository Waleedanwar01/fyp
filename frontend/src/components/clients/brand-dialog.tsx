"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { MatchTester } from "@/components/clients/match-tester";
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
import { brandSchema, type BrandInput } from "@/lib/validation";

export type BrandRecord = {
  id: string;
  client: string;
  name: string;
  aliases: string[];
  created_at: string;
};

const toList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function BrandDialog({
  clientId,
  clientName,
  brand,
  onClose,
  onSaved,
}: {
  clientId: string;
  clientName: string;
  brand: BrandRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BrandInput>({
    resolver: zodResolver(brandSchema),
    defaultValues: { name: brand?.name ?? "", aliases: brand?.aliases.join(", ") ?? "" },
  });

  const submit = async (data: BrandInput) => {
    setFormError(null);
    try {
      const payload = { name: data.name, aliases: toList(data.aliases) };
      if (brand) {
        await api.patch(`/brands/${brand.id}/`, payload);
      } else {
        await api.post("/brands/", { client: clientId, ...payload });
      }
      onSaved();
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  const deleteBrand = async () => {
    if (!brand) return;
    if (!window.confirm(`Delete the brand profile for ${clientName}? This can't be undone.`)) return;
    setFormError(null);
    try {
      await api.delete(`/brands/${brand.id}/`);
      onSaved();
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-6 gap-5">
        <DialogHeader className="gap-1.5 pb-3 border-b border-border/70">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Sparkles className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {brand ? "Brand Identity & Alias Engine" : "Configure Brand Identity"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Primary recognition profile for <strong className="font-semibold text-foreground">{clientName}</strong> — detected in AI model output audits.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-3.5 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <FormField label="Official Brand Name" htmlFor="brand-name" error={errors.name?.message} required>
              <Input
                id="brand-name"
                placeholder="e.g. Johnny & Jugnu"
                className="rounded-xl text-xs"
                autoFocus
                {...register("name")}
              />
            </FormField>

            <FormField
              label="Aliases & Name Variations"
              htmlFor="brand-aliases"
              error={errors.aliases?.message}
            >
              <Input
                id="brand-aliases"
                placeholder="e.g. Johnny and Jugnu, J&J Lahore, Johnny Jugnu"
                className="rounded-xl text-xs"
                {...register("aliases")}
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated variations or abbreviations that should credit this client when cited.
              </p>
            </FormField>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <DialogFooter className={brand ? "sm:justify-between items-center" : "items-center"}>
            {brand && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={deleteBrand}
                className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl gap-1.5"
              >
                <Trash2 className="size-3.5" />
                <span>Delete Brand</span>
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting} className="rounded-xl text-xs font-semibold px-4">
                {isSubmitting ? "Saving Brand…" : "Save Brand"}
              </Button>
            </div>
          </DialogFooter>
        </form>

        {brand && (
          <div className="border-t border-border/70 pt-4">
            <MatchTester testUrl={`/brands/${brand.id}/test-match/`} label="brand" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

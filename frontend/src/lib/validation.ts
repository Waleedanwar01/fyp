import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    agencyName: z.string().min(2, "Agency name must be at least 2 characters"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    plan: z.string().optional(),
    billingInterval: z.enum(["monthly", "yearly"]).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const clientSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  industry: z.string().optional(),
  targetLocations: z.array(z.string()).min(1, "Add at least one target location"),
  services: z.string().optional(),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const addClientSchema = clientSchema.extend({
  brandName: z.string().optional(),
  brandAliases: z.string().optional(),
  competitors: z.string().optional(),
});
export type AddClientInput = z.infer<typeof addClientSchema>;

export const brandSchema = z.object({
  name: z.string().min(1, "Brand name is required"),
  aliases: z.string().optional(),
});
export type BrandInput = z.infer<typeof brandSchema>;

export const competitorSchema = z.object({
  name: z.string().min(1, "Competitor name is required"),
  aliases: z.string().optional(),
});
export type CompetitorInput = z.infer<typeof competitorSchema>;

export const promptSchema = z.object({
  text: z.string().min(1, "Prompt text is required"),
  category: z.string().optional(),
  serviceTags: z.string().optional(),
  locationTags: z.string().optional(),
  isActive: z.boolean(),
});
export type PromptInput = z.infer<typeof promptSchema>;

export const promptScheduleSchema = z
  .object({
    brand: z.string().min(1, "This client needs a brand before it can have a schedule"),
    prompts: z.array(z.string()).min(1, "Select at least one prompt"),
    providers: z.array(z.string()).min(1, "Select at least one AI provider"),
    frequency: z.enum(["once", "daily", "weekly", "monthly", "custom"]),
    customIntervalDays: z.string().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    runTime: z.string().min(1, "Pick a time"),
    timezone: z.string().min(1, "Timezone is required"),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  })
  .refine((data) => data.frequency !== "custom" || !!data.customIntervalDays, {
    message: "Required when frequency is custom",
    path: ["customIntervalDays"],
  });
export type PromptScheduleInput = z.infer<typeof promptScheduleSchema>;

export const matchTestSchema = z.object({
  text: z.string().min(1, "Enter some text to test against"),
});
export type MatchTestInput = z.infer<typeof matchTestSchema>;

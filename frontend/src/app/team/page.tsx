"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Check,
  CheckCircle2,
  Clock,
  Crown,
  HelpCircle,
  Mail,
  MoreHorizontal,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, extractErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type TeamMember = {
  id: string;
  email: string;
  role: "admin" | "member";
  is_active: boolean;
  date_joined: string;
};

const MAX_TEAM_MEMBERS = 5;

const inviteSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  role: z.enum(["admin", "member"]),
});
type InviteInput = z.infer<typeof inviteSchema>;

export default function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const canManage = user?.role === "admin";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: "member" },
  });

  const loadMembers = useCallback(() => {
    api
      .get<TeamMember[]>("/team-members/")
      .then(({ data }) => setMembers(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  useEffect(() => {
    if (user) loadMembers();
  }, [user, loadMembers]);

  const atCapacity = members !== null && members.length >= MAX_TEAM_MEMBERS;

  const onInvite = async (data: InviteInput) => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await api.post("/team-members/invite/", data);
      setInviteSuccess(`Invitation successfully sent to ${data.email}.`);
      reset({ email: "", role: "member" });
      loadMembers();
      setTimeout(() => setInviteSuccess(null), 4000);
    } catch (error) {
      setInviteError(extractErrorMessage(error));
    }
  };

  const updateMember = async (id: string, patch: Partial<Pick<TeamMember, "role" | "is_active">>) => {
    setRowError(null);
    try {
      await api.patch(`/team-members/${id}/`, patch);
      loadMembers();
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  const removeMember = async (id: string, email: string) => {
    if (!window.confirm(`Are you sure you want to remove ${email} from your agency team?`)) return;
    setRowError(null);
    try {
      await api.delete(`/team-members/${id}/`);
      loadMembers();
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  if (!user) return <AppShell>{null}</AppShell>;

  const adminCount = members?.filter((m) => m.role === "admin").length || 0;
  const memberCount = members?.filter((m) => m.role === "member").length || 0;
  const totalCount = members?.length || 0;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Header HUD */}
        <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-xs">
              <Users className="size-7" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Team Management</h1>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {user.agency?.name ?? "Agency Workspace"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Manage team members, roles, and collaborative workspace permissions for your agency.
              </p>
            </div>
          </div>

          {/* Seat Counter Widget */}
          <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-secondary/20 p-3 self-start sm:self-auto">
            <div className="flex flex-col">
              <span className="text-[10.5px] font-semibold uppercase text-muted-foreground">Team Capacity</span>
              <div className="flex items-baseline gap-1">
                <span className="text-base font-bold text-foreground">{totalCount}</span>
                <span className="text-xs text-muted-foreground">/ {MAX_TEAM_MEMBERS} seats used</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Total Teammates</span>
              <span className="text-xl font-bold text-foreground">{totalCount}</span>
            </div>
            <div className="flex size-9 items-center justify-center rounded-lg bg-secondary/50 text-foreground">
              <Users className="size-4" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Workspace Admins</span>
              <span className="text-xl font-bold text-primary">{adminCount}</span>
            </div>
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Crown className="size-4" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Active Members</span>
              <span className="text-xl font-bold text-foreground">{memberCount}</span>
            </div>
            <div className="flex size-9 items-center justify-center rounded-lg bg-secondary/50 text-foreground">
              <Shield className="size-4" />
            </div>
          </div>
        </div>

        {/* Invite Teammate Card */}
        {canManage && (
          <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="size-4 text-primary" />
                <CardTitle className="text-base font-semibold">Invite New Teammate</CardTitle>
              </div>
              <CardDescription className="text-xs">
                {atCapacity
                  ? `Your agency has reached the maximum of ${MAX_TEAM_MEMBERS} team seats.`
                  : "Send an invitation email to a colleague to join your agency workspace."}
              </CardDescription>
            </CardHeader>
            {!atCapacity && (
              <CardContent className="pt-1">
                <form
                  onSubmit={handleSubmit(onInvite)}
                  className="flex flex-col gap-4 sm:flex-row sm:items-end"
                  noValidate
                >
                  <FormField
                    label="Teammate Email Address"
                    htmlFor="invite-email"
                    error={errors.email?.message}
                    className="flex-1"
                    required
                  >
                    <div className="relative flex items-center">
                      <Mail className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="colleague@youragency.com"
                        className="rounded-xl pl-9"
                        {...register("email")}
                      />
                    </div>
                  </FormField>

                  <FormField label="Role & Access Level" htmlFor="invite-role" error={errors.role?.message} className="w-full sm:w-48">
                    <select
                      id="invite-role"
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium outline-none transition hover:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      {...register("role")}
                    >
                      <option value="member">Member (Audits & Prompts)</option>
                      <option value="admin">Admin (Full Control & Billing)</option>
                    </select>
                  </FormField>

                  <Button type="submit" disabled={isSubmitting} className="h-10 gap-2 rounded-xl px-5 font-semibold">
                    <UserPlus className="size-4" />
                    <span>{isSubmitting ? "Inviting…" : "Send Invite"}</span>
                  </Button>
                </form>

                {inviteError && (
                  <p className="mt-3 text-xs font-medium text-destructive">{inviteError}</p>
                )}
                {inviteSuccess && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    <span>{inviteSuccess}</span>
                  </p>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Team Members Roster */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Team Members Roster</CardTitle>
                <CardDescription className="text-xs">
                  Active accounts and pending invitations with access to this workspace.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {listError && <p className="p-4 text-xs text-destructive">{listError}</p>}
            {rowError && <p className="p-4 text-xs text-destructive">{rowError}</p>}
            {members === null && !listError && (
              <p className="p-8 text-center text-xs text-muted-foreground">Loading team roster…</p>
            )}

            {members && members.length === 0 && (
              <p className="p-8 text-center text-xs text-muted-foreground">No team members found.</p>
            )}

            {members && members.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[300px] text-xs font-semibold">Teammate</TableHead>
                    <TableHead className="text-xs font-semibold">Role</TableHead>
                    <TableHead className="text-xs font-semibold">Status</TableHead>
                    <TableHead className="text-xs font-semibold">Date Joined</TableHead>
                    {canManage && <TableHead className="text-right text-xs font-semibold">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => {
                    const isSelf = m.id === user.id;
                    const initial = m.email.charAt(0).toUpperCase();

                    return (
                      <TableRow key={m.id} className="transition-colors hover:bg-secondary/25">
                        {/* Member Info */}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                              {initial}
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-foreground">{m.email}</span>
                                {isSelf && (
                                  <span className="rounded-md bg-secondary px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                                    You
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        {/* Role Badge */}
                        <TableCell>
                          {m.role === "admin" ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                              <Crown className="size-3" />
                              Admin
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              <Shield className="size-3" />
                              Member
                            </span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          {m.is_active ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                              <Clock className="size-3" />
                              Pending Invite
                            </span>
                          )}
                        </TableCell>

                        {/* Joined Date */}
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {new Date(m.date_joined).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </TableCell>

                        {/* Actions */}
                        {canManage && (
                          <TableCell className="text-right">
                            {!isSelf && (
                              <DropdownMenu>
                                <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-transparent text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                                  <MoreHorizontal className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44 rounded-xl">
                                  <DropdownMenuLabel className="text-[11px]">Manage Role</DropdownMenuLabel>
                                  {m.role === "member" ? (
                                    <DropdownMenuItem onClick={() => updateMember(m.id, { role: "admin" })}>
                                      <Crown className="mr-2 size-3.5 text-primary" />
                                      <span>Promote to Admin</span>
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem onClick={() => updateMember(m.id, { role: "member" })}>
                                      <Shield className="mr-2 size-3.5 text-muted-foreground" />
                                      <span>Demote to Member</span>
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => removeMember(m.id, m.email)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 size-3.5" />
                                    <span>Remove from Team</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Roles & Permissions Matrix */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Role Permissions Matrix</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Understand the access differences between Admin and Member roles.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="py-2.5 font-semibold">Capability</th>
                    <th className="py-2.5 text-center font-semibold text-primary">Admin</th>
                    <th className="py-2.5 text-center font-semibold text-foreground">Member</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <tr>
                    <td className="py-2.5 text-foreground">Manage Clients, Brands & Competitors</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-foreground">Execute AI Prompts & Schedules</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-foreground">Export White-Label PDF Reports</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-foreground">Manage Team Members & Invites</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center text-muted-foreground">—</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-foreground">Manage Billing, Subscriptions & Invoices</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center text-muted-foreground">—</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 text-foreground">Edit Agency Branding & Subdomain</td>
                    <td className="py-2.5 text-center"><Check className="mx-auto size-4 text-emerald-500" /></td>
                    <td className="py-2.5 text-center text-muted-foreground">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

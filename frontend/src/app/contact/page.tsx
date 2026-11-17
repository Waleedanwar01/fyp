"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  Building2,
  Send,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  ArrowRight,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function ContactPage() {
  const [agencyName, setAgencyName] = useState("");
  const [email, setEmail] = useState("");
  const [clientCount, setClientCount] = useState("10-25 Clients");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1 px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-4xl flex flex-col gap-10">
          <div className="text-center flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              <span>Agency Partnerships & Enterprise Support</span>
            </div>
            <h1 className="text-3xl font-bold sm:text-5xl">Get In Touch With RankLens</h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Have questions about custom high-volume prompt run quotas, multi-seat agency setups, or white-label
              reporting integrations? We&apos;re here to help.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-12 md:items-start">
            {/* Left Form */}
            <div className="md:col-span-7 rounded-2xl border border-border bg-card p-7 shadow-xs">
              {submitted ? (
                <div className="py-12 text-center flex flex-col items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <h3 className="text-xl font-bold">Message Received!</h3>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Thank you for reaching out. An RankLens agency specialist will reply to <strong>{email}</strong> within one business day.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setSubmitted(false);
                      setMessage("");
                    }}
                  >
                    Send Another Note
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Agency Name</label>
                    <Input
                      placeholder="Apex Marketing Agency"
                      value={agencyName}
                      onChange={(e) => setAgencyName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Work Email</label>
                    <Input
                      type="email"
                      placeholder="alex@apexmarketing.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Active Client Roster Size</label>
                    <select
                      value={clientCount}
                      onChange={(e) => setClientCount(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                    >
                      <option value="1-5 Clients">1–5 Clients (Starter)</option>
                      <option value="10-25 Clients">10–25 Clients (Growth)</option>
                      <option value="50+ Clients">50+ Clients (Agency)</option>
                      <option value="100+ Enterprise">100+ Clients (Custom Enterprise)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">How can we help?</label>
                    <Textarea
                      placeholder="Tell us about your agency's AI visibility tracking requirements..."
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                    />
                  </div>

                  <Button type="submit" size="lg" className="w-full mt-2 font-semibold">
                    <Send className="size-4 mr-2" />
                    Submit Agency Inquiry
                  </Button>
                </form>
              )}
            </div>

            {/* Right Information */}
            <div className="md:col-span-5 flex flex-col gap-5">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-4">
                <h3 className="font-bold text-base">Direct Channels</h3>
                <div className="flex flex-col gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Mail className="size-4" />
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">Support & Sales</p>
                      <p>support@ranklens.app</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="size-4" />
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">Headquarters</p>
                      <p>San Francisco, CA · Remote-First</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-xs flex flex-col gap-3">
                <span className="text-xs font-bold text-primary uppercase">Immediate Self-Service</span>
                <p className="text-xs text-muted-foreground">
                  Need to start testing right now? Launch our live interactive demo or test checkout with 1-click bypass.
                </p>
                <Button
                  render={<Link href="/checkout?plan=growth&interval=monthly" />}
                  nativeButton={false}
                  size="sm"
                  className="w-full mt-1"
                >
                  Start Test Checkout
                  <ArrowRight className="size-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

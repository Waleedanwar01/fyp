import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroSection } from "@/components/marketing/hero-section";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ProblemSection } from "@/components/marketing/problem-section";
import { UniverseSection } from "@/components/marketing/universe-section";
import { PlatformSection } from "@/components/marketing/platform-section";
import { ProofSection } from "@/components/marketing/proof-section";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import { StatsSection } from "@/components/marketing/stats-section";
import { ProvidersSection } from "@/components/marketing/providers-section";
import { TrustSection } from "@/components/marketing/trust-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { TestimonialsWall } from "@/components/marketing/testimonials-wall";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";
import { HighlightsMarquee } from "@/components/marketing/highlights-marquee";
import { SmoothScroll } from "@/components/marketing/smooth-scroll";

export default function Home() {
  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SmoothScroll />
      <SiteHeader />
      <main>
        <HeroSection />
        <TrustStrip />
        <ProblemSection />
        <UniverseSection />
        <PlatformSection />
        <ProofSection />
        <HowItWorksSection />
        <StatsSection />
        <ProvidersSection />
        <TestimonialsWall />
        <PricingSection />
        <FinalCtaSection />
        <TrustSection />
        <HighlightsMarquee />
      </main>
      <SiteFooter />
    </div>
  );
}

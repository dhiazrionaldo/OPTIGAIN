import { LoginForm } from "@/components/auth/login-form"
import { TrendingUp, BarChart3, Zap, Shield } from "lucide-react"
import Image from "next/image"
import logo from '@/assets/Logo_.png'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen">
      {/* Left branded panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-card p-12 relative overflow-hidden">
        {/* Decorative grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
          backgroundSize: "64px 64px"
        }} />
        {/* Decorative glow */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/10 blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full bg-accent/10 blur-[96px]" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/30">
              <Image src={logo} alt={""} />
            </div>
            <span className="text-lg font-semibold text-foreground tracking-tight">OPTIGAIN</span>
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-8">
          <h2 className="text-4xl font-bold tracking-tight text-foreground text-balance leading-[1.15]">
            Optimize your gross profit with AI-powered insights
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-md">
            Upload your financial data, let our AI engine analyze and recommend pricing optimizations to maximize margins.
          </p>
          <div className="flex flex-col gap-4">
            {[
              { icon: BarChart3, text: "Real-time margin analysis" },
              { icon: Zap, text: "AI-powered recommendations" },
              { icon: Shield, text: "Enterprise-grade security" },
            ].map((feature) => (
              <div key={feature.text} className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                {feature.text}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xs text-muted-foreground/60">OPTIGAIN &mdash; Enterprise Analytics Platform</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-6 lg:p-12">
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/30">
            <Image src={logo} alt={""} />
          </div>
          <span className="text-lg font-semibold text-foreground tracking-tight">OPTIGAIN</span>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}

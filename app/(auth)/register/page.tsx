import { RegisterForm } from "@/components/auth/register-form"
import { TrendingUp, BarChart3, Zap, Shield } from "lucide-react"
import Image from "next/image"
import logo from '@/assets/Logo_.png'

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen">
      {/* Left branded panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-slate-50 p-12 relative overflow-hidden border-r border-border">
        {/* Decorative grid - Menggunakan variabel border agar halus */}
        <div className="absolute inset-0 opacity-[0.05]" style={{
          backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "48px 48px"
        }} />
        
        {/* Decorative glow - Diatur ulang posisinya agar tidak bertumpuk dengan teks */}
        <div className="absolute top-1/3 left-1/3 w-96 h-96 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-72 h-72 rounded-full bg-primary/10 blur-[100px]" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            {/* Logo Container */}
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-border">
              <Image src={logo} alt="Logo" className="h-7 w-7" />
            </div>

            {/* Text Group (Bungkus di sini agar menumpuk vertikal) */}
            <div className="flex flex-col justify-center">
              <span className="text-xl font-bold text-foreground tracking-tighter leading-none">
                BISA
              </span>
              {/* Slogan dibuat lebih kecil & soft agar terlihat seperti sub-brand modern */}
              <p className="text-[10px] text-muted-foreground tracking-wide mt-1 leading-none">
                <b className="text-primary">B</b>erani <b className="text-primary">I</b>nnovatif <b className="text-primary">S</b>inergi <b className="text-primary">A</b>daptif
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-10">
          <div className="space-y-4">
            <h2 className="text-5xl font-extrabold tracking-tight text-foreground text-balance leading-[1.1]">
              Start <span className="text-primary">optimizing</span> your margins today
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
              Join teams that use AI to unlock hidden profit potential in their pricing and cost structures.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {[
              { icon: BarChart3, text: "Real-time margin analysis", color: "text-accent", bg: "bg-accent/10" },
              { icon: Zap, text: "AI-powered recommendations", color: "text-primary", bg: "bg-primary/10" },
              { icon: Shield, text: "Internal Environment Access Only", color: "text-orange-500", bg: "bg-orange-500/10" },
            ].map((feature) => (
              <div key={feature.text} className="flex items-center gap-4 text-base font-medium text-foreground/80">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${feature.bg} shadow-sm border border-white/50`}>
                  <feature.icon className={`h-5 w-5 ${feature.color}`} />
                </div>
                {feature.text}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            <p className="text-sm font-medium text-muted-foreground/80">BISA &mdash; Enterprise Analytics Platform</p>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-primary/3  p-6 lg:p-12">
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/30">
            <Image src={logo} alt={""} />
          </div>
          <span className="text-lg font-semibold tracking-tight">BISA</span>
        </div>
        <RegisterForm />
      </div>
    </main>
  )
}

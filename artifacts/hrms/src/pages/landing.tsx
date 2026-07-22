import { Link } from 'wouter';
import { Building2, Users, Calendar, TrendingUp, Shield, Globe, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function Landing() {
  const features = [
    {
      icon: Users,
      title: 'Employee Records',
      description: 'Centralized employee database with comprehensive profile management, org charts, and document storage.'
    },
    {
      icon: Calendar,
      title: 'Leave & Attendance',
      description: 'Automated leave tracking, attendance monitoring, shift scheduling, and timesheet management.'
    },
    {
      icon: TrendingUp,
      title: 'Performance Management',
      description: 'Goal setting, performance reviews, 360-degree feedback, and development planning tools.'
    },
    {
      icon: Shield,
      title: 'Compliance & Security',
      description: 'Role-based access control, audit trails, and industry-standard security protocols.'
    }
  ];

  const sectors = [
    { name: 'Businesses', desc: 'Corporations and SMEs' },
    { name: 'Churches', desc: 'Religious organizations' },
    { name: 'NGOs', desc: 'Non-profit organizations' },
    { name: 'Schools', desc: 'Educational institutions' },
    { name: 'Hospitals', desc: 'Healthcare facilities' },
    { name: 'Hotels', desc: 'Hospitality industry' },
    { name: 'Government', desc: 'Public sector agencies' }
  ];

  const benefits = [
    'Reduce administrative overhead by up to 60%',
    'Improve employee engagement and retention',
    'Ensure compliance with labor regulations',
    'Access real-time workforce analytics',
    'Scale effortlessly as your organization grows'
  ];

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <Building2 className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-lg font-semibold text-foreground font-sans">Enterprise HRMS</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" data-testid="button-login">Login</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-background via-muted/20 to-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-foreground mb-6 leading-tight">
                Human Resources, Simplified and Powerful
              </h2>
              <p className="text-lg lg:text-xl text-muted-foreground mb-8 leading-relaxed">
                A complete HR management system built for organizations that value their people. Manage employee records, track performance, automate workflows, and gain insights—all in one secure platform.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/login">
                  <Button size="lg" className="gap-2" data-testid="button-get-started">
                    Get Started
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <div className="aspect-[4/3] rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
                <div className="h-full w-full bg-gradient-to-br from-primary/10 via-accent/10 to-primary/10 flex items-center justify-center p-8">
                  <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                    {[Users, Calendar, TrendingUp, Shield].map((Icon, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + i * 0.1 }}
                        className="aspect-square rounded-xl border border-border bg-card flex items-center justify-center shadow-md"
                      >
                        <Icon className="h-10 w-10 text-primary" />
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 lg:py-28 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              Everything You Need to Manage Your Workforce
            </h3>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From onboarding to retirement, streamline every aspect of human resource management.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group rounded-xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h4 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Sectors Section */}
      <section className="py-20 lg:py-28 bg-muted/30 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">
              <Globe className="h-4 w-4" />
              Trusted Across Industries
            </div>
            <h3 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              Built for Organizations of All Types
            </h3>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Whether you're a private business, public institution, or non-profit, our platform adapts to your unique HR needs.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {sectors.map((sector, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="rounded-lg border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <h5 className="text-base font-semibold text-foreground mb-1">{sector.name}</h5>
                <p className="text-sm text-muted-foreground">{sector.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 lg:py-28 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
            <div>
              <h3 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
                Transform How You Manage People
              </h3>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Stop juggling spreadsheets, paper files, and disconnected systems. Enterprise HRMS brings order to HR chaos with tools designed for clarity, efficiency, and growth.
              </p>
              <ul className="space-y-4">
                {benefits.map((benefit, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-3"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
                        <Check className="h-4 w-4 text-accent" />
                      </div>
                    </div>
                    <span className="text-base text-foreground">{benefit}</span>
                  </motion.li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="aspect-square rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
                <div className="h-full w-full bg-gradient-to-br from-accent/10 via-primary/10 to-accent/10 flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-primary mb-6">
                      <TrendingUp className="h-12 w-12 text-primary-foreground" />
                    </div>
                    <p className="text-2xl font-bold text-foreground mb-2">60% Faster</p>
                    <p className="text-muted-foreground">HR processing time</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 lg:py-28 bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
            Ready to Modernize Your HR Operations?
          </h3>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join organizations worldwide who trust Enterprise HRMS to manage their most valuable asset—their people.
          </p>
          <Link href="/login">
            <Button size="lg" className="gap-2" data-testid="button-cta-start">
              Get Started Today
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Building2 className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-sm font-medium text-foreground">Enterprise HRMS</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Enterprise HRMS. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

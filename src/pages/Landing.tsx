import { motion } from "framer-motion";
import {
  ArrowRight,
  MessageSquareText,
  Monitor,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";

const features = [
  {
    icon: MessageSquareText,
    title: "Describe. Done.",
    body: "Plain language in. A working web app out — rebuilt live on every prompt.",
  },
  {
    icon: Paperclip,
    title: "Bring your files",
    body: "Attach anything. The agent reads it and folds it into the build.",
  },
  {
    icon: Monitor,
    title: "See it instantly",
    body: "A live preview sits beside the chat and updates as you work.",
  },
];

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-screen flex-col bg-background"
    >
      {/* Header */}
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" />
            </span>            <span className="text-sm font-semibold tracking-tight">RBuilder</span>
          </div>
          <nav className="flex items-center gap-1">
            {isLoading ? null : isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => navigate("/dashboard")}
              >
                Open app
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => navigate("/auth")}
              >
                Sign in
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-24 pb-20 md:pt-32 md:pb-28">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <Badge
              variant="outline"
              className="rounded-full border-border/80 font-normal text-muted-foreground"
            >
              Version 1 — chat + live preview
            </Badge>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-balance md:text-6xl">
              Build a web app from a single chat.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              RBuilder turns a prompt — and any files you attach — into a
              running application, rendered next to the conversation the moment
              it is written. Completely free, no subscription, no credits.
            </p>
            <div className="mt-10 flex items-center gap-3">
              <Button
                size="lg"
                className="h-11 rounded-md px-6 text-sm font-medium"
                onClick={() =>
                  navigate(isAuthenticated ? "/dashboard" : "/auth")
                }
              >
                {isAuthenticated ? "Open your workspace" : "Start building"}
                <ArrowRight className="ml-1 size-4" />
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="h-11 rounded-md px-6 text-sm font-medium text-muted-foreground"
                onClick={() => navigate("/auth")}
              >
                Sign in
              </Button>
            </div>
          </motion.div>

          {/* Product mock — the actual v1 layout, at a glance */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
            className="mt-20 overflow-hidden rounded-lg border border-border/80 bg-card"
          >
            <div className="flex h-9 items-center gap-1.5 border-b border-border/70 bg-muted/50 px-4">
              <span className="size-2 rounded-full bg-border" />
              <span className="size-2 rounded-full bg-border" />
              <span className="size-2 rounded-full bg-border" />
            </div>
            <div className="grid md:grid-cols-[1fr_1.4fr]">
              <div className="flex flex-col gap-4 border-b border-border/70 p-6 md:border-r md:border-b-0">
                <div className="h-2 w-16 rounded-full bg-border" />
                <div className="h-2 w-full rounded-full bg-border" />
                <div className="h-2 w-4/5 rounded-full bg-border" />
                <div className="h-16 rounded-md border border-border/70 bg-muted/40" />
                <div className="mt-auto flex h-9 items-center rounded-md border border-border/70 bg-muted/40 px-3">
                  <span className="h-2 w-1/3 rounded-full bg-border" />
                </div>
              </div>
              <div className="bg-muted/20 p-6">
                <div className="flex h-full min-h-56 flex-col items-center justify-center rounded-md border border-dashed border-border/70">
                  <Monitor className="size-5 text-muted-foreground/60" />
                  <span className="mt-2 text-xs text-muted-foreground/70">
                    live preview
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Features */}
          <div className="mt-20 grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/60 md:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="bg-card p-8">
                <feature.icon className="size-5 text-muted-foreground" />
                <h3 className="mt-4 text-sm font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Completely free. No subscription, no credits, no API key needed.
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in and start with your first prompt.
              </p>
            </div>
            <Button
              size="lg"
              className="h-11 rounded-md px-6 text-sm font-medium"
              onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}
            >
              Get started
              <ArrowRight className="ml-1 size-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} RBuilder</span>
          <span>The free coding agent</span>
        </div>
      </footer>
    </motion.div>
  );
}

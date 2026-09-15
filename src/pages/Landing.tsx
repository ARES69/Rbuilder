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
    title: "Опиши — и готово",
    body: "Обычным языком. На выходе — работающее веб-приложение, пересобираемое после каждого запроса.",
  },
  {
    icon: Paperclip,
    title: "Прикрепляйте файлы",
    body: "Приложите что угодно: агент прочитает файл и встроит его в сборку.",
  },
  {
    icon: Monitor,
    title: "Видно сразу",
    body: "Живой предпросмотр рядом с чатом обновляется по мере работы.",
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
            </span>
            <span className="text-sm font-semibold tracking-tight">RBuilder</span>
          </div>
          <nav className="flex items-center gap-1">
            {isLoading ? null : isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => navigate("/dashboard")}
              >
                Открыть приложение
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => navigate("/auth")}
              >
                Войти
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
              Версия 1 — чат + живой предпросмотр
            </Badge>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-balance md:text-6xl">
              Приложение из одного чата.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              RBuilder превращает запрос — и любые прикреплённые файлы — в
              работающее приложение, которое появляется рядом с диалогом сразу
              после сборки. Полностью бесплатно: без подписки и кредитов.
            </p>
            <div className="mt-10 flex items-center gap-3">
              <Button
                size="lg"
                className="h-11 rounded-md px-6 text-sm font-medium"
                onClick={() =>
                  navigate(isAuthenticated ? "/dashboard" : "/auth")
                }
              >
                {isAuthenticated ? "Открыть воркспейс" : "Начать сборку"}
                <ArrowRight className="ml-1 size-4" />
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="h-11 rounded-md px-6 text-sm font-medium text-muted-foreground"
                onClick={() => navigate("/auth")}
              >
                Войти
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
                    живой предпросмотр
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

          {/* RF-specific: integrations highlight */}
          <div className="mt-12 rounded-lg border border-border/80 bg-card p-6">
            <h3 className="text-sm font-semibold tracking-tight">
              Интеграции с российскими сервисами
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Битрикс24, 1С, amoCRM, ЮKassa, Т-Банк, СДЭК, Boxberry, DaData,
              Telegram, VK, SMS Aero, Диадок, Яндекс Диск — подключаются прямо
              во вкладке «Интеграции», ключи хранятся только на сервере.
            </p>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Полностью бесплатно. Без подписки, кредитов и обязательных
                ключей.
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Войдите и начните с первого запроса.
              </p>
            </div>
            <Button
              size="lg"
              className="h-11 rounded-md px-6 text-sm font-medium"
              onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}
            >
              Начать
              <ArrowRight className="ml-1 size-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} RBuilder</span>
          <span>Бесплатный ИИ-агент для сборки приложений</span>
        </div>
      </footer>
    </motion.div>
  );
}

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { LogoDropdown } from "@/components/LogoDropdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowLeft,
  FolderKanban,
  Loader2,
  MessageSquare,
  Plug,
  ShieldAlert,
  Users,
} from "lucide-react";

const numberFormat = new Intl.NumberFormat("ru-RU");

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="gap-0 rounded-lg border-border/70 py-4 shadow-none">
      <CardContent className="px-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          <Icon className="size-3.5 text-muted-foreground/70" />
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums">
          {numberFormat.format(value)}
        </p>
        {hint ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { isLoading: authLoading } = useAuth();
  const data = useQuery(api.admin.overview, {});

  if (authLoading || data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <ShieldAlert className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Доступ только для администратора</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Войдите с админскими правами, чтобы открыть консоль.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/auth?returnTo=/admin">Войти как администратор</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/dashboard">К проектам</Link>
          </Button>
        </div>
      </main>
    );
  }

  const peak = Math.max(1, ...data.activity.map((entry) => entry.messages));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <LogoDropdown />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">RBuilder</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-sm text-muted-foreground">Консоль администратора</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <Link to="/dashboard">
              <ArrowLeft className="size-3.5" />
              К проектам
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Обзор платформы
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.viewer.email ?? "admin"} · полный доступ ко всем данным
            </p>
          </div>
          <Badge variant="outline" className="h-6 rounded-full px-2.5 text-[10px] font-normal">
            role: admin
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Пользователи"
            value={data.totals.users}
            hint={`${numberFormat.format(data.totals.anonymous)} анонимных · ${numberFormat.format(data.totals.admins)} админ.`}
            icon={Users}
          />
          <Stat
            label="Проекты"
            value={data.totals.projects}
            hint={`${numberFormat.format(data.totals.published)} с собранной версией`}
            icon={FolderKanban}
          />
          <Stat
            label="Сообщения"
            value={data.totals.messages}
            hint={data.messagesCapped ? "счётчик ограничен выборкой" : "все диалоги"}
            icon={MessageSquare}
          />
          <Stat
            label="Сессии сегодня"
            value={data.totals.sessionsToday}
            hint={`${numberFormat.format(data.totals.attachments)} файлов загружено`}
            icon={Activity}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="gap-0 rounded-lg border-border/70 py-5 lg:col-span-2">
            <CardHeader className="px-5 pb-4">
              <CardTitle className="text-sm font-medium">
                Активность за 7 дней
              </CardTitle>
              <CardDescription className="text-xs">
                Сообщения в диалогах с агентом
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <div className="flex h-32 items-end gap-2">
                {data.activity.map((entry) => (
                  <div
                    key={entry.day}
                    className="flex flex-1 flex-col items-center gap-2"
                    title={`${entry.day}: ${entry.messages}`}
                  >
                    <div className="flex h-full w-full items-end">
                      <div
                        className={cn(
                          "w-full rounded-sm bg-foreground/80 transition-all",
                          entry.messages === 0 && "bg-border",
                        )}
                        style={{
                          height: `${Math.max(2, (entry.messages / peak) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatDay(entry.day)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 rounded-lg border-border/70 py-5">
            <CardHeader className="px-5 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Plug className="size-3.5 text-muted-foreground" />
                Подключения сервисов
              </CardTitle>
              <CardDescription className="text-xs">
                {numberFormat.format(data.totals.connections)} подключений ·{" "}
                {numberFormat.format(data.totals.events)} событий
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {data.connectionsByService.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground/80">
                  Пока никто не подключил сервис.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border/60">
                  {data.connectionsByService.map((entry) => (
                    <li
                      key={entry.serviceId}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="font-mono text-xs">{entry.serviceId}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {numberFormat.format(entry.total)}
                        {entry.errors > 0 && (
                          <Badge
                            variant="outline"
                            className="h-4 rounded-full px-1.5 text-[9px] font-normal text-destructive"
                          >
                            {numberFormat.format(entry.errors)} с ошибкой
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="gap-0 rounded-lg border-border/70 py-5">
            <CardHeader className="px-5 pb-3">
              <CardTitle className="text-sm font-medium">
                Новые пользователи
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-[11px]">Email</TableHead>
                    <TableHead className="h-8 text-[11px]">Роль</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentUsers.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="py-2 text-xs">
                        {entry.email ?? "—"}
                        {entry.anonymous ? (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            гость
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 rounded-full px-2 text-[10px] font-normal",
                            entry.role === "admin" && "border-foreground/30",
                          )}
                        >
                          {entry.role}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="gap-0 rounded-lg border-border/70 py-5">
            <CardHeader className="px-5 pb-3">
              <CardTitle className="text-sm font-medium">
                Последние проекты
              </CardTitle>
              <CardDescription className="text-xs">
                {numberFormat.format(data.totals.skillsEnabled)} навыков и{" "}
                {numberFormat.format(data.totals.toolsEnabled)} инструментов
                включено пользователями
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-[11px]">Проект</TableHead>
                    <TableHead className="h-8 text-[11px]">Владелец</TableHead>
                    <TableHead className="h-8 text-right text-[11px]">
                      Версия
                    </TableHead>
                    <TableHead className="h-8 text-right text-[11px]">
                      Создан
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="max-w-[160px] truncate py-2 text-xs">
                        {project.name}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate py-2 text-[11px] text-muted-foreground">
                        {project.owner}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">
                        {project.version > 0 ? `v${project.version}` : "—"}
                      </TableCell>
                      <TableCell className="py-2 text-right text-[11px] text-muted-foreground tabular-nums">
                        {formatDate(project.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <p className="text-[11px] leading-5 text-muted-foreground/70">
          Доступ выдаётся провайдером admin-credentials (логин и пароль из
          переменных окружения ADMIN_USERNAME / ADMIN_PASSWORD). Смените значения
          по умолчанию во вкладке API-ключей проекта, прежде чем открывать
          приложение публично.
        </p>
      </main>
    </div>
  );
}

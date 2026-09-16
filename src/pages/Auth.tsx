import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps { redirectAfterAuth?: string }

function Auth({ redirectAfterAuth = "/dashboard" }: AuthProps) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const redirect = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : redirectAfterAuth;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adminTarget = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(adminTarget.current && !returnTo ? "/admin" : redirect, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirect, returnTo]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    adminTarget.current = true;
    try {
      await signIn("admin-credentials", {
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch (authError) {
      adminTarget.current = false;
      setError(authError instanceof Error ? authError.message : "Неверный логин или пароль");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-border/70 bg-card/90">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-300">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-lg">Административный вход</CardTitle>
          <CardDescription className="text-xs">
            Пользовательская регистрация отключена. Workspace открывается автоматически.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-3">
            <div className="relative">
              <UserRound className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <Input name="username" placeholder="Логин администратора" autoComplete="username" className="pl-9" disabled={loading} required />
            </div>
            <div className="relative">
              <LockKeyhole className="absolute top-3 left-3 size-4 text-muted-foreground" />
              <Input name="password" type="password" placeholder="Пароль" autoComplete="current-password" className="pl-9" disabled={loading} required />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              Войти как администратор
            </Button>
            <Button type="button" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => navigate("/dashboard")}>
              Вернуться в workspace
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

export default function AuthPage(props: AuthProps) {
  return <Suspense><Auth {...props} /></Suspense>;
}

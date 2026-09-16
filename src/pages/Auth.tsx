import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | "admin" | { email: string }>(
    "signIn",
  );
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a successful admin sign-in so the admin lands on the console
  // instead of the regular dashboard. Navigation happens in the effect below
  // once the session is actually live, which avoids racing it.
  const [landAdmin, setLandAdmin] = useState(false);
  const adminTargetRef = useRef(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const target =
        (landAdmin || adminTargetRef.current) && !searchParams.get("returnTo")
          ? "/admin"
          : redirect;
      navigate(target);
    }
  }, [authLoading, isAuthenticated, navigate, redirect, landAdmin, searchParams]);
  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить код подтверждения. Попробуйте ещё раз.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);

      console.log("signed in");

      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);

      setError("Неверный код подтверждения.");
      setIsLoading(false);

      setOtp("");
    }
  };

  /** Admin sign-in: username + password (see convex/auth/adminCredentials.ts). */
  const handleAdminSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    try {
      // Set the navigation intent before auth state can update. Convex Auth may
      // publish isAuthenticated in the same render as signIn resolves.
      adminTargetRef.current = true;
      setLandAdmin(true);
      await signIn("admin-credentials", {
        username: formData.get("username") as string,
        password: formData.get("password") as string,
      });
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : "";
      adminTargetRef.current = false;
      setLandAdmin(false);
      setError(
        message.includes("Введите логин") ? message : "Неверный логин или пароль",
      );
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log("Attempting anonymous sign in...");
      await signIn("anonymous");
      console.log("Anonymous sign in successful");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      setError(`Не удалось войти как гость: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">

      
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
        <Card className="min-w-[350px] pb-0 border shadow-md">
          {step === "admin" ? (
            <>
              <CardHeader className="text-center">
                <div className="flex justify-center">
                  <div className="mt-4 mb-4 flex size-16 items-center justify-center rounded-lg border border-border/70">
                    <ShieldCheck className="size-7 text-muted-foreground" />
                  </div>
                </div>
                <CardTitle className="text-xl">Вход для администратора</CardTitle>
                <CardDescription>
                  Логин и пароль администратора RBuilder
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleAdminSubmit}>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <UserRound className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="username"
                      placeholder="Логин"
                      autoComplete="username"
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <div className="relative">
                    <LockKeyhole className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="password"
                      type="password"
                      placeholder="Пароль"
                      autoComplete="current-password"
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Проверяем…
                      </>
                    ) : (
                      <>
                        Войти как администратор
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => {
                      setStep("signIn");
                      setLandAdmin(false);
                      setError(null);
                    }}
                    disabled={isLoading}
                  >
                    Обычный вход
                  </Button>
                </CardFooter>
              </form>
            </>
          ) : step === "signIn" ? (
            <>
              <CardHeader className="text-center">
              <div className="flex justify-center">
                    <img
                      src={logo}
                      alt="Lock Icon"
                      width={64}
                      height={64}
                      className="rounded-lg mb-4 mt-4 cursor-pointer"
                      onClick={() => navigate("/")}
                    />
                  </div>
                <CardTitle className="text-xl">Начать работу</CardTitle>
                <CardDescription>
                  Введите email, чтобы войти или зарегистрироваться
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleEmailSubmit}>
                <CardContent>
                  
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {error && (
                    <p className="mt-2 text-sm text-red-500">{error}</p>
                  )}
                  
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          Или
                        </span>
                      </div>
                    </div>
                    
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-4"
                      onClick={handleGuestLogin}
                      disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Продолжить как гость
                    </Button>

                    <Button
                      type="button"
                      variant="link"
                      className="mt-2 w-full text-xs text-muted-foreground"
                      onClick={() => {
                        setStep("admin");
                        setError(null);
                      }}
                      disabled={isLoading}
                    >
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                      Вход для администратора
                    </Button>
                  </div>
                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>Проверьте почту</CardTitle>
                <CardDescription>
                  Мы отправили код на {step.email}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit}>
                <CardContent className="pb-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          // Find the closest form and submit it
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p className="mt-2 text-sm text-red-500 text-center">
                      {error}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    Не пришёл код?{" "}
                    <Button
                      type="button"
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => {
                        setStep("signIn");
                        setOtp("");
                        setError(null);
                      }}
                    >
                      Попробовать снова
                    </Button>
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Проверяем…
                      </>
                    ) : (
                      <>
                        Подтвердить код
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="w-full"
                  >
                    Использовать другой email
                  </Button>
                </CardFooter>
              </form>
            </>
          )}

          <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
            Защищено RBuilder — бесплатный ИИ-агент
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}

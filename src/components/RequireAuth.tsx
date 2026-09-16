import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Opens the workspace immediately. Convex still receives an anonymous session
 * internally so existing project queries remain isolated per browser session;
 * the user never sees a registration or email form.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, signIn } = useAuth();
  const [startingGuestSession, setStartingGuestSession] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || isAuthenticated || attempted.current) return;
    attempted.current = true;
    setStartingGuestSession(true);
    void signIn("anonymous").catch(() => {
      setStartingGuestSession(false);
    });
  }, [isLoading, isAuthenticated, signIn]);

  if (isLoading || !isAuthenticated || startingGuestSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-blue-400" />
          <p className="text-xs text-muted-foreground">Открываем workspace…</p>
        </div>
      </main>
    );
  }

  return children;
}

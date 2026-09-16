import type { DesktopRuntime } from "@/lib/desktop-bridge";

declare global {
  interface Window {
    /**
     * Optional native bridge injected by the RBuilder Desktop shell.
     * The web app never assumes this exists.
     */
    __RBULDER_DESKTOP__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };

    /**
     * Navigate to the auth page with a custom redirect URL
     * @param redirectUrl - URL to redirect to after successful authentication
     */
    navigateToAuth: (redirectUrl: string) => void;
  }

  // Keep the imported type referenced in this declaration file for editor tooling.
  type RBuilderDesktopRuntime = DesktopRuntime;
}

export {};
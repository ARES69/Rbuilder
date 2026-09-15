import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeId = "light" | "dark" | "tomorrow";

export const THEMES: { id: ThemeId; label: string; hint: string }[] = [
  { id: "light", label: "Светлая", hint: "Минималистичный белый" },
  { id: "dark", label: "Тёмная", hint: "Монохромная тёмная" },
  { id: "tomorrow", label: "Tomorrow Light Blue", hint: "Голубой акцент" },
];

const STORAGE_KEY = "rbuilder-theme";

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "tomorrow") {
    return stored;
  }
  return "light";
}

function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  root.classList.remove("dark", "theme-tomorrow");
  if (theme === "dark") root.classList.add("dark");
  if (theme === "tomorrow") root.classList.add("theme-tomorrow");
}

const ThemeContext = createContext<{
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}>({ theme: "light", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — theme just won't persist
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

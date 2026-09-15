import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, useTheme, type ThemeId } from "@/lib/theme";
import { Check, Moon, MoonStar, Sun, SunMoon } from "lucide-react";

const ICONS: Record<ThemeId, typeof Sun> = {
  light: Sun,
  dark: Moon,
  tomorrow: SunMoon,
  "tomorrow-dark": MoonStar,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const ActiveIcon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Сменить тему"
        >
          <ActiveIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Тема
        </DropdownMenuLabel>
        {THEMES.map((item) => {
          const Icon = ICONS[item.id];
          const active = theme === item.id;
          return (
            <DropdownMenuItem
              key={item.id}
              className="cursor-pointer justify-between"
              onClick={() => setTheme(item.id)}
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span>
                  <span className="block text-xs font-medium">{item.label}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {item.hint}
                  </span>
                </span>
              </span>
              {active ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

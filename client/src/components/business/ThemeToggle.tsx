import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const modes = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "系统", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center rounded-md border p-1">
      {modes.map((mode) => {
        const Icon = mode.icon;
        return (
          <button
            key={mode.value}
            onClick={() => setTheme(mode.value)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              theme === mode.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
            title={`切换到${mode.label}主题`}
          >
            <Icon className="size-3.5" />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

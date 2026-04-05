import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ThemeProvider,
  useThemeContext,
} from "../src/providers/theme/ThemeProvider";

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("ThemeProvider", () => {
  it("updates theme and persists to localStorage", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper });

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem("jchat.theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

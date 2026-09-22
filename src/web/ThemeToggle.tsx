import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "./themeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span className="theme-toggle-slider" aria-hidden="true">
        <span className={`theme-toggle-icon ${isDark ? "is-dark" : "is-light"}`}>
          <HugeiconsIcon
            icon={isDark ? Moon01Icon : Sun01Icon}
            size={16}
            strokeWidth={1.8}
          />
        </span>
      </span>
    </button>
  );
}

export default ThemeToggle;

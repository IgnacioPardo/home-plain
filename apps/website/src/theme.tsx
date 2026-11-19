import { useEffect, useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const storageKey = "home-theme";
const systemQuery = "(prefers-color-scheme: dark)";

function readPreference(): Theme | null {
    try {
        const saved = localStorage.getItem(storageKey);
        return saved === "light" || saved === "dark" ? saved : null;
    } catch {
        return null;
    }
}

export function ThemeToggle() {
    const [preference, setPreference] = useState(readPreference);
    const [systemDark, setSystemDark] = useState(() => matchMedia(systemQuery).matches);
    const theme = preference ?? (systemDark ? "dark" : "light");
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = theme === "dark" ? "Oscuro" : "Claro";
    const action = `Cambiar a modo ${nextTheme === "dark" ? "oscuro" : "claro"}`;

    useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme;
        document
            .querySelector('meta[name="theme-color"]')
            ?.setAttribute("content", theme === "dark" ? "#14171c" : "#f6f6f5");
    }, [theme]);

    useEffect(() => {
        const media = matchMedia(systemQuery);
        const onSystemChange = () => setSystemDark(media.matches);
        const onStorage = (event: StorageEvent) => {
            if (event.key === storageKey || event.key === null) {
                setPreference(readPreference());
            }
        };
        // Account for a preference change between the initial render and subscription.
        onSystemChange();
        media.addEventListener("change", onSystemChange);
        window.addEventListener("storage", onStorage);
        return () => {
            media.removeEventListener("change", onSystemChange);
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    function toggle() {
        setPreference(nextTheme);
        try {
            localStorage.setItem(storageKey, nextTheme);
        } catch {
            // The current visit still works when browser storage is unavailable.
        }
    }

    return (
        <button
            type="button"
            className="theme-toggle"
            aria-label={`Modo ${label.toLowerCase()}. ${action}`}
            title={action}
            onClick={toggle}
        >
            {theme === "dark" ? (
                <Moon size={19} aria-hidden="true" />
            ) : (
                <Sun size={19} aria-hidden="true" />
            )}
            <span>{label}</span>
        </button>
    );
}

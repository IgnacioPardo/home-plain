import { act } from "react";
import { runInNewContext } from "node:vm";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import html from "../index.html?raw";
import { ThemeToggle } from "./theme";

let container: HTMLDivElement;
let root: Root;
let media: MediaQueryList;
let systemDark: boolean;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    systemDark = false;
    media = Object.assign(new EventTarget(), {
        get matches() {
            return systemDark;
        },
        media: "(prefers-color-scheme: dark)",
    }) as MediaQueryList;
    Object.defineProperty(media, "matches", { get: () => systemDark });
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => media),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelector('meta[name="theme-color"]')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
});

async function render() {
    await act(async () => root.render(<ThemeToggle />));
}

async function click() {
    await act(async () => container.querySelector("button")!.click());
}

async function changeSystem(dark: boolean) {
    systemDark = dark;
    await act(async () => media.dispatchEvent(new Event("change")));
}

it("follows the system until a manual choice, then keeps that choice", async () => {
    await render();
    expect(document.documentElement.dataset.theme).toBe("light");
    await changeSystem(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    await click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("home-theme")).toBe("light");
    await changeSystem(false);
    await changeSystem(true);
    expect(document.documentElement.dataset.theme).toBe("light");
});

it("restores a saved theme and preserves selection through remounts", async () => {
    localStorage.setItem("home-theme", "dark");
    await render();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toContain("Modo oscuro");
    await click();
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
        "#f6f6f5",
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toContain(
        "Cambiar a modo oscuro",
    );
});

it("treats an invalid saved value as a system preference", async () => {
    localStorage.setItem("home-theme", "unexpected");
    systemDark = true;
    await render();
    expect(document.documentElement.dataset.theme).toBe("dark");
});

it("allows switching when browser storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
    });
    await render();
    await click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    await changeSystem(true);
    await changeSystem(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
});

it("updates another tab's saved selection and follows the system when it is cleared", async () => {
    await render();
    localStorage.setItem("home-theme", "dark");
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "home-theme" })));
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.clear();
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(document.documentElement.dataset.theme).toBe("light");
});

it.each(["light", "dark"])("applies saved %s before React mounts", (theme) => {
    localStorage.setItem("home-theme", theme);
    systemDark = theme === "light";
    const bootstrap = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)![1];
    runInNewContext(bootstrap, { localStorage, matchMedia, document });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(container.childElementCount).toBe(0);
});

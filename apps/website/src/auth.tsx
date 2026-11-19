import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import type { AuthSession } from "@repo/client";
import { useAuthSession } from "./auth.queries";
import { House, LogOut } from "lucide-react";
import { ThemeToggle } from "./theme";
import "./auth.css";

type SessionState = {
    session: AuthSession | null;
    logout: () => Promise<void>;
    busy: boolean;
    error: string | null;
};
const SessionContext = createContext<SessionState | null>(null);
export function useSession() {
    return useContext(SessionContext)?.session ?? null;
}

export function AuthGate({ children }: { children: ReactNode }) {
    const { session, loading, busy, error, check, login, logout } = useAuthSession();
    if (loading)
        return (
            <main className="auth-page">
                <p role="status">Comprobando sesión…</p>
            </main>
        );
    if (!session) return <LoginForm busy={busy} error={error} onLogin={login} onRetry={check} />;
    return (
        <SessionContext.Provider value={{ session, logout, busy, error }}>
            {children}
        </SessionContext.Provider>
    );
}

function LoginForm({
    busy,
    error,
    onLogin,
    onRetry,
}: {
    busy: boolean;
    error: string | null;
    onLogin: (username: string, password: string) => Promise<void>;
    onRetry: () => Promise<void>;
}) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!busy) void onLogin(username, password);
    };
    return (
        <main className="auth-page">
            <div className="auth-theme">
                <ThemeToggle />
            </div>
            <section className="auth-card" aria-labelledby="login-title">
                <div className="auth-brand">
                    <House size={24} aria-hidden="true" /> Home
                </div>
                <h1 id="login-title">Iniciar sesión</h1>
                <form onSubmit={submit}>
                    <label htmlFor="login-username">Usuario</label>
                    <input
                        id="login-username"
                        name="username"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                        maxLength={64}
                        disabled={busy}
                    />
                    <label htmlFor="login-password">Contraseña</label>
                    <input
                        id="login-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        maxLength={1024}
                        disabled={busy}
                    />
                    {error && (
                        <p className="auth-error" role="alert">
                            {error}
                        </p>
                    )}
                    <button className="button auth-submit" type="submit" disabled={busy}>
                        {busy ? "Ingresando…" : "Entrar"}
                    </button>
                </form>
                {error?.includes("comprobar") && (
                    <button className="text-link" onClick={() => void onRetry()}>
                        Volver a comprobar
                    </button>
                )}
            </section>
        </main>
    );
}

export function SessionControls({ showLabel = false }: { showLabel?: boolean }) {
    const context = useContext(SessionContext);
    if (!context?.session) return null;
    return (
        <div className="session-controls">
            <span
                className="session-name"
                title={context.session.role === "owner" ? "Propietario" : "Cuenta compartida"}
            >
                {context.session.username}
            </span>
            <button
                type="button"
                className="session-logout"
                disabled={context.busy}
                onClick={() => void context.logout()}
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
            >
                <LogOut size={17} aria-hidden="true" />
                {showLabel && <span>Cerrar sesión</span>}
            </button>
            {context.error && (
                <p role="alert" className="session-error">
                    {context.error}
                </p>
            )}
        </div>
    );
}

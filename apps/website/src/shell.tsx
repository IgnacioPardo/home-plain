import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import {
    Grid2X2,
    House,
    Images,
    ListChecks,
    LockKeyhole,
    Ellipsis,
    StickyNote,
} from "lucide-react";
import { GlobalSearch } from "./search";
import { Modal, SyncStatus } from "./ui";
import { ThemeToggle } from "./theme";
import { SessionControls } from "./auth";
import { ItemPhotosProvider } from "./item-photos";

export function Shell() {
    return (
        <ItemPhotosProvider>
            <ShellContent />
        </ItemPhotosProvider>
    );
}

function ShellContent() {
    const [menuOpen, setMenuOpen] = useState(false);
    const pathname = useLocation({ select: (location) => location.pathname });
    return (
        <div className="app-shell">
            <a className="skip" href="#main">
                Saltar al contenido
            </a>
            <header className="site-header">
                <div className="header-inner">
                    <Link className="brand" to="/" aria-label="Home, inicio">
                        <House size={21} strokeWidth={1.7} aria-hidden="true" />
                        Home
                    </Link>
                    <GlobalSearch />
                    <nav aria-label="Principal">
                        <Link
                            to="/"
                            className={pathname === "/coleccion" ? "active" : undefined}
                            activeOptions={{ exact: true }}
                            activeProps={{ className: "active" }}
                        >
                            <Grid2X2 size={18} aria-hidden="true" />
                            Catálogo
                        </Link>
                        <Link
                            to="/lista"
                            className={pathname === "/compras" ? "active" : undefined}
                            activeProps={{ className: "active" }}
                        >
                            <ListChecks size={18} aria-hidden="true" />
                            Lista
                        </Link>
                        <Link to="/ambientes" activeProps={{ className: "active" }}>
                            <House size={18} aria-hidden="true" />
                            Ambientes
                        </Link>
                        <Link
                            to="/referencias"
                            className={pathname === "/moodboard" ? "active" : undefined}
                            activeProps={{ className: "active" }}
                        >
                            <Images size={18} aria-hidden="true" />
                            Referencias
                        </Link>
                        <Link to="/notas" activeProps={{ className: "active" }}>
                            <StickyNote size={18} aria-hidden="true" />
                            Notas
                        </Link>
                    </nav>
                    <div className="header-utilities">
                        <ThemeToggle />
                        <button
                            type="button"
                            className="mobile-menu-trigger"
                            aria-label="Más opciones"
                            aria-haspopup="dialog"
                            onClick={() => setMenuOpen(true)}
                        >
                            <Ellipsis size={22} aria-hidden="true" />
                        </button>
                        <div className="header-account">
                            <SessionControls />
                        </div>
                    </div>
                </div>
            </header>
            {menuOpen && (
                <Modal title="Cuenta" className="mobile-menu" onClose={() => setMenuOpen(false)}>
                    <div className="detail-text">
                        <h2>Cuenta</h2>
                        <SessionControls showLabel />
                    </div>
                </Modal>
            )}
            <main id="main">
                <Outlet />
            </main>
            <footer className="site-footer">
                <SyncStatus />
                <Link to="/fuentes" className="footer-private">
                    <LockKeyhole size={11} />
                    Fuentes
                </Link>
            </footer>
        </div>
    );
}

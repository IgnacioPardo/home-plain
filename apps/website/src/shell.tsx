import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import {
    ArrowUpRight,
    BookOpen,
    Grid2X2,
    House,
    Images,
    ListChecks,
    LockKeyhole,
    Ellipsis,
    StickyNote,
} from "lucide-react";
import { GlobalSearch } from "./search";
import { ExternalLink, Modal, SyncStatus } from "./ui";
import { notionHome } from "./sources";
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
                            <a
                                className="header-notion"
                                href={notionHome}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <BookOpen size={16} aria-hidden="true" />
                                Notion
                                <ArrowUpRight size={13} />
                            </a>
                        </div>
                    </div>
                </div>
            </header>
            {menuOpen && (
                <Modal
                    title="Cuenta y enlaces"
                    className="mobile-menu"
                    onClose={() => setMenuOpen(false)}
                >
                    <div className="detail-text">
                        <h2>Cuenta y enlaces</h2>
                        <SessionControls showLabel />
                        <ExternalLink href={notionHome}>Abrir Notion</ExternalLink>
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

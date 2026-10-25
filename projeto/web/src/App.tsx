import type { ReactNode } from "react";
import { BrowserRouter, HashRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { IS_DESKTOP } from "./lib/platform";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { RecoverPage } from "./pages/RecoverPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { ModuleList } from "./student/ModuleList";
import { ModulePlayer } from "./student/ModulePlayer";
import { UserManagement } from "./admin/UserManagement";
import { PdfLibrary } from "./admin/PdfLibrary";
import { ModulesAdmin } from "./admin/ModulesAdmin";
import { ModuleEditor } from "./admin/ModuleEditor";

// No .exe os arquivos são servidos localmente: HashRouter evita 404 ao recarregar.
const Router = IS_DESKTOP ? HashRouter : BrowserRouter;

export function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/cadastro" element={<SignupPage />} />
          <Route path="/recuperar" element={<RecoverPage />} />
          <Route path="/trocar-senha" element={<RequireAuth allowPasswordChange><ChangePasswordPage /></RequireAuth>} />

          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/aluno" element={<ModuleList />} />
            <Route path="/aluno/modulo/:id" element={<ModulePlayer />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<UserManagement />} />
              <Route path="/admin/pdfs" element={<PdfLibrary />} />
              <Route path="/admin/modulos" element={<ModulesAdmin />} />
              <Route path="/admin/modulos/:id" element={<ModuleEditor />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

function Splash() {
  return <div className="splash">Carregando…</div>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <Splash />;
  if (session && profile?.status === "active") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAuth({ children, allowPasswordChange }: { children: ReactNode; allowPasswordChange?: boolean }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Splash />;
  if (profile.must_change_password && !allowPasswordChange) return <Navigate to="/trocar-senha" replace />;
  return <>{children}</>;
}

function RequireAdmin() {
  const { profile } = useAuth();
  return profile?.role === "admin" ? <Outlet /> : <Navigate to="/aluno" replace />;
}

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === "admin" ? "/admin" : "/aluno"} replace />;
}

function Shell() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === "admin";
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">E</span> EduPDF <strong>IA</strong>
        </div>
        <nav className="nav">
          {isAdmin && (
            <>
              <NavLink to="/admin" end>
                Usuários
              </NavLink>
              <NavLink to="/admin/pdfs">PDFs</NavLink>
              <NavLink to="/admin/modulos">Módulos</NavLink>
            </>
          )}
          <NavLink to="/aluno">{isAdmin ? "Visão do aluno" : "Meus módulos"}</NavLink>
        </nav>
        <div className="user-menu">
          <span className="muted small hide-sm">{profile?.full_name || profile?.email}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

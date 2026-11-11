import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const STATUS_TABS = [
  ["pending", "Pendientes"],
  ["approved", "Aprobadas"],
  ["rejected", "Rechazadas"],
  ["expired", "Vencidas"],
];

const STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  expired: "Vencida",
};

function submissionDate(vacancy) {
  const date = vacancy.created_at || vacancy.submitted_at || vacancy.published_at;
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

function textLines(value) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function applicationMethodLabel(method) {
  return { email: "Correo electrónico", whatsapp: "WhatsApp", external_url: "Sitio externo" }[method] || "Sin método";
}

async function getAdminVacancies(token) {
  const response = await fetch("/api/admin/vacantes", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudieron cargar las vacantes.");
  return result;
}

export default function AdminVacantes() {
  const [view, setView] = useState("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [supabase, setSupabase] = useState(null);
  const [token, setToken] = useState("");
  const [vacancies, setVacancies] = useState([]);
  const [activeStatus, setActiveStatus] = useState("pending");
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let subscription;
    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/config");
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "La autenticación no está configurada.");
        const client = createClient(config.url, config.anonKey);
        if (!active) return;
        setSupabase(client);
        const { data } = await client.auth.getSession();
        if (!active) return;
        if (data.session?.access_token) await verifySession(client, data.session.access_token);
        else setView("login");
        const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
          if (!session?.access_token) {
            setToken("");
            setVacancies([]);
            setView("login");
          }
        });
        subscription = listener.subscription;
      } catch (error) {
        if (!active) return;
        setErrorMessage(error.message);
        setView("login");
      }
    }
    async function verifySession(client, accessToken) {
      try {
        const rows = await getAdminVacancies(accessToken);
        if (!active) return;
        setToken(accessToken);
        setVacancies(rows);
        setErrorMessage("");
        setView("admin");
      } catch (error) {
        if (!active) return;
        setToken("");
        setErrorMessage(error.message);
        setView(error.message.includes("permiso") ? "denied" : "login");
        await client.auth.signOut();
      }
    }
    restoreSession();
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    if (!supabase) return;
    setLoginBusy(true);
    setErrorMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) {
      setErrorMessage("No se pudo iniciar sesión. Revisa tu correo y contraseña.");
      setLoginBusy(false);
      return;
    }
    try {
      const rows = await getAdminVacancies(data.session.access_token);
      setToken(data.session.access_token);
      setVacancies(rows);
      setView("admin");
    } catch (requestError) {
      await supabase.auth.signOut();
      setErrorMessage(requestError.message);
      setView(requestError.message.includes("permiso") ? "denied" : "login");
    } finally {
      setLoginBusy(false);
    }
  }

  async function refreshVacancies() {
    const rows = await getAdminVacancies(token);
    setVacancies(rows);
  }

  async function performAction(vacancy, action, isVip) {
    const messages = {
      approve: `¿Aprobar y publicar “${vacancy.job_title}” por 60 días?`,
      reject: `¿Rechazar la vacante “${vacancy.job_title}”?`,
      vip: `¿${isVip ? "Marcar" : "Quitar la marca de"} VIP a “${vacancy.job_title}”?`,
      renew: `¿Renovar “${vacancy.job_title}” por 60 días?`,
    };
    if (!window.confirm(messages[action])) return;
    setBusyId(vacancy.id);
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/vacantes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: vacancy.id, action, isVip }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar la vacante.");
      await refreshVacancies();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyId(null);
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setToken("");
    setVacancies([]);
    setView("login");
  }

  const filteredVacancies = vacancies.filter((vacancy) => vacancy.status === activeStatus);

  return (
    <div className="admin-shell">
      <header className="site-header admin-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Chambaleo, inicio"><img className="brand-mark" src="/leo.png" alt="" width="31" height="31" /><span>chambaleo<span className="brand-period">.</span></span></Link>
          <div className="admin-header-actions"><span>Administración</span>{view === "admin" && <button type="button" onClick={signOut}>Cerrar sesión</button>}</div>
        </div>
      </header>

      {view === "loading" ? (
        <main className="admin-loading" aria-live="polite">Verificando sesión…</main>
      ) : view !== "admin" ? (
        <main className="admin-login-wrap">
          <section className="admin-login" aria-labelledby="admin-login-title">
            <img src="/leo.png" alt="" width="48" height="50" />
            <div className="section-kicker">CHAMBALEO · ADMINISTRACIÓN</div>
            <h1 id="admin-login-title">Acceso del equipo</h1>
            <p>{view === "denied" ? "Esta cuenta no tiene permisos de administración." : "Inicia sesión con tu cuenta autorizada para revisar vacantes."}</p>
            {view !== "denied" && <form onSubmit={signIn}>
              <label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {errorMessage && <div className="admin-alert admin-alert-error" role="alert">{errorMessage}</div>}
              <button className="primary-button" type="submit" disabled={loginBusy}>{loginBusy ? "Verificando…" : "Iniciar sesión"}</button>
            </form>}
            {view === "denied" && <div className="admin-alert admin-alert-error" role="alert">{errorMessage}</div>}
            <Link className="admin-back-link" href="/">Volver a Chambaleo</Link>
          </section>
        </main>
      ) : (
        <main className="admin-content">
          <div className="admin-page-heading">
            <div><div className="section-kicker">PANEL DE CONTROL</div><h1>Vacantes</h1><p>Revisa las solicitudes y administra su publicación.</p></div>
            <span className="admin-total">{vacancies.length} en total</span>
          </div>
          {errorMessage && <div className="admin-alert admin-alert-error" role="alert">{errorMessage}</div>}
          <div className="admin-tabs" role="tablist" aria-label="Filtrar vacantes por estado">
            {STATUS_TABS.map(([status, label]) => <button key={status} type="button" role="tab" aria-selected={activeStatus === status} className={activeStatus === status ? "is-active" : ""} onClick={() => setActiveStatus(status)}>{label}<span>{vacancies.filter((vacancy) => vacancy.status === status).length}</span></button>)}
          </div>
          {filteredVacancies.length ? <div className="admin-vacancy-list">
            {filteredVacancies.map((vacancy) => {
              const expanded = expandedId === vacancy.id;
              const busy = busyId === vacancy.id;
              return <article className="admin-vacancy" key={vacancy.id}>
                <div className="admin-vacancy-main">
                  <div className="admin-vacancy-title"><h2>{vacancy.job_title || "Vacante sin título"}</h2><span className={`admin-status status-${vacancy.status}`}>{STATUS_LABELS[vacancy.status] || vacancy.status}</span>{vacancy.is_vip && <span className="admin-vip">VIP</span>}</div>
                  <div className="admin-vacancy-meta"><strong>{vacancy.company_name || "Empresa sin nombre"}</strong><span>{vacancy.company_email || "Sin correo"}</span><span>{submissionDate(vacancy)}</span></div>
                  <div className="admin-vacancy-actions">
                    <button type="button" className="admin-preview-button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : vacancy.id)}>{expanded ? "Ocultar detalle" : "Vista previa"}</button>
                    {vacancy.status !== "approved" && <button type="button" className="admin-action-primary" disabled={busy} onClick={() => performAction(vacancy, vacancy.status === "expired" ? "renew" : "approve")}>{vacancy.status === "expired" ? "Renovar 60 días" : "Aprobar"}</button>}
                    {vacancy.status !== "rejected" && vacancy.status !== "expired" && <button type="button" className="admin-action-danger" disabled={busy} onClick={() => performAction(vacancy, "reject")}>Rechazar</button>}
                    <button type="button" className="admin-vip-button" disabled={busy} onClick={() => performAction(vacancy, "vip", !vacancy.is_vip)}>{vacancy.is_vip ? "Quitar VIP" : "Marcar VIP"}</button>
                  </div>
                </div>
                {expanded && <div className="admin-vacancy-preview">
                  <div className="admin-preview-grid"><div><span>Ubicación</span><strong>{[vacancy.city, vacancy.state].filter(Boolean).join(", ") || "No especificada"}</strong></div><div><span>Modalidad</span><strong>{vacancy.work_mode || "No especificada"}</strong></div><div><span>Tipo de empleo</span><strong>{vacancy.employment_type || "No especificado"}</strong></div><div><span>Experiencia</span><strong>{vacancy.experience_level || "No especificada"}</strong></div></div>
                  <section><h3>Descripción</h3><p>{vacancy.description || "Sin descripción."}</p></section>
                  <section><h3>Responsabilidades</h3><ul>{textLines(vacancy.responsibilities).length ? textLines(vacancy.responsibilities).map((line, index) => <li key={`${index}-${line}`}>{line}</li>) : <li>No especificadas.</li>}</ul></section>
                  <section><h3>Requisitos</h3><ul>{textLines(vacancy.requirements).length ? textLines(vacancy.requirements).map((line, index) => <li key={`${index}-${line}`}>{line}</li>) : <li>No especificados.</li>}</ul></section>
                  {vacancy.benefits && <section><h3>Beneficios</h3><p>{vacancy.benefits}</p></section>}
                  <div className="admin-preview-footer">Postulación: {applicationMethodLabel(vacancy.application_method)} · {vacancy.application_value || "Sin dato"}</div>
                </div>}
              </article>;
            })}
          </div> : <div className="admin-empty">No hay vacantes {STATUS_TABS.find(([status]) => status === activeStatus)?.[1].toLowerCase()}.</div>}
        </main>
      )}
      <footer className="site-footer admin-footer"><Link className="brand" href="/"><img className="brand-mark" src="/leo.png" alt="" width="25" height="25" /><span>chambaleo<span className="brand-period">.</span></span></Link><small>© 2026 Chambaleo · México</small></footer>
    </div>
  );
}
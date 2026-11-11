import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

function Logo() {
  return <Link className="brand" href="/" aria-label="Chambaleo, inicio"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M27.3 8.6a13 13 0 1 0 0 18.8" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" /><path d="m20 13 6 5-6 5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>chambaleo<span className="brand-period">.</span></span></Link>;
}

function JobLogo({ job }) {
  return <span className="company-logo company-logo-large">
    <svg className="company-logo-default" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4M8 7h1m6 0h1M8 11h1m6 0h1" /></svg>
    {job.logoUrl && <img className="company-logo-image" src={job.logoUrl} alt={`${job.company}`} />}
  </span>;
}

function detailLines(value) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

export default function JobDetails() {
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || !router.query.id) return;
    let active = true;
    fetch(`/api/vacantes?id=${encodeURIComponent(router.query.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Vacante no disponible");
        return response.json();
      })
      .then((vacancy) => { if (active) setJob(vacancy); })
      .catch(() => { if (active) setJob(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router.isReady, router.query.id]);

  if (!router.isReady || loading) return null;
  if (!job) {
    return (
      <div className="not-found-page">
        <header className="site-header"><div className="header-inner"><Logo /><Link className="post-link" href="/">Volver al inicio</Link></div></header>
        <main className="not-found-content"><span>404</span><h1>Esta vacante ya no está disponible.</h1><p>Explora otras oportunidades que podrían ser para ti.</p><Link className="primary-button" href="/">Ver vacantes <span>→</span></Link></main>
      </div>
    );
  }

  return (
    <>
      <header className="site-header"><div className="header-inner"><Logo /><nav className="header-nav" aria-label="Navegación principal"><Link className="nav-link" href="/">Explorar empleos</Link><Link className="post-link" href="/publicar-vacante">Publicar vacante <span>→</span></Link></nav></div></header>
      <main className="detail-page">
        <Link className="back-link" href="/">← <span>Volver a vacantes</span></Link>
        <div className="detail-layout">
          <article className="detail-main">
            <section className="detail-header-card">
              <JobLogo job={job} />
              <div className="detail-title-wrap">
                {job.featured && <span className="detail-vip">✦ VACANTE VIP</span>}
                <h1>{job.title}</h1>
                <p>{job.company} <span>·</span> {job.city}</p>
              </div>
              <div className="job-tags"><span>{job.mode}</span><span>{job.type}</span></div>
            </section>
            <section className="detail-section">
              <h2>Sobre la vacante</h2>
              <p>{job.description || `En ${job.company} buscamos personas con talento que quieran crecer y hacer la diferencia. Súmate a nuestro equipo y construyamos algo increíble.`}</p>
            </section>
            <section className="detail-section">
              <h2>¿Qué harás?</h2>
              {detailLines(job.responsibilities).length ? <ul>{detailLines(job.responsibilities).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Consulta la descripción de la vacante para conocer sus responsabilidades.</p>}
            </section>
            <section className="detail-section">
              <h2>Lo que buscamos</h2>
              {detailLines(job.requirements).length ? <ul>{detailLines(job.requirements).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Consulta la descripción de la vacante para conocer los requisitos.</p>}
            </section>
            {job.benefits && <section className="detail-section"><h2>Beneficios</h2><p>{job.benefits}</p></section>}
            <div className="detail-disclaimer">Vacante revisada por Chambaleo. Las condiciones y el proceso de selección son responsabilidad de la empresa que publica.</div>
          </article>
          <aside className="detail-sidebar">
            <div className="apply-card">
              <div className="apply-card-top"><span>SUELDO</span><strong>{job.salary || "A convenir"}</strong></div>
              <div className="apply-meta"><span>📍</span><div><small>Ubicación</small><strong>{job.city}</strong></div></div>
              <div className="apply-meta"><span>◷</span><div><small>Modalidad</small><strong>{job.mode} · {job.type}</strong></div></div>
              <div className="apply-meta"><span>◷</span><div><small>Publicada</small><strong>{job.posted}</strong></div></div>
              {job.applicationMethod === "email" && job.applicationValue && <a className="apply-button" href={`mailto:${job.applicationValue}`}>Postularme <span>→</span></a>}
              {job.applicationMethod === "whatsapp" && job.applicationValue && <a className="apply-button" href={`https://wa.me/${job.applicationValue.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Postularme <span>→</span></a>}
              {job.applicationMethod === "external_url" && /^https:\/\//i.test(job.applicationValue) && <a className="apply-button" href={job.applicationValue} target="_blank" rel="noreferrer">Postularme <span>→</span></a>}
              <p className="apply-note">Tu siguiente oportunidad podría empezar aquí.</p>
            </div>
            <div className="sidebar-tip"><span>✦</span><strong>Un tip para ti</strong><p>Actualiza tu CV y destaca tus logros para llamar la atención de las empresas.</p></div>
          </aside>
        </div>
      </main>
      <footer className="site-footer"><Logo /><span>Hecho para que encuentres tu siguiente gran oportunidad. <b>♥</b></span><small>© 2026 Chambaleo · México</small></footer>
    </>
  );
}

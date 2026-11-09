import Link from "next/link";
import { useRouter } from "next/router";
import { jobs } from "../../data/jobs";

function Logo() {
  return <Link className="brand" href="/" aria-label="Chambaleo, inicio"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M27.3 8.6a13 13 0 1 0 0 18.8" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" /><path d="m20 13 6 5-6 5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>chambaleo<span className="brand-period">.</span></span></Link>;
}

function JobLogo({ job }) {
  return <span className={`company-logo company-logo-large logo-${job.color}`}>{job.logo}</span>;
}

export default function JobDetails() {
  const router = useRouter();
  const job = jobs.find((vacancy) => vacancy.id === router.query.id);

  if (!router.isReady) return null;
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
              <ul>{(job.responsibilities || ["Colaborar con un equipo comprometido y multidisciplinario.", "Proponer ideas y soluciones para mejorar nuestros procesos.", "Contribuir a las metas del equipo con tu experiencia."]).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section className="detail-section">
              <h2>Lo que buscamos</h2>
              <ul>{(job.requirements || ["Experiencia relacionada con el puesto.", "Actitud proactiva y ganas de aprender.", "Comunicación efectiva y trabajo en equipo."]).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <div className="detail-disclaimer">Esta es una vacante de muestra para Chambaleo. Los datos de contacto y el proceso de postulación se habilitarán próximamente.</div>
          </article>
          <aside className="detail-sidebar">
            <div className="apply-card">
              <div className="apply-card-top"><span>SUELDO MENSUAL</span><strong>{job.salary || "A convenir"}</strong></div>
              <div className="apply-meta"><span>📍</span><div><small>Ubicación</small><strong>{job.city}</strong></div></div>
              <div className="apply-meta"><span>◷</span><div><small>Modalidad</small><strong>{job.mode} · {job.type}</strong></div></div>
              <div className="apply-meta"><span>◷</span><div><small>Publicada</small><strong>{job.posted}</strong></div></div>
              <button className="apply-button" type="button" onClick={() => window.alert("¡Gracias por tu interés! La postulación estará disponible próximamente.")}>Postularme <span>→</span></button>
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

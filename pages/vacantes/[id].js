import Head from "next/head";
import Link from "next/link";
import { getSupabaseAdmin } from "../../lib/supabaseServer";
import { isUnexpired, toPublicVacancy } from "../../lib/vacancyData";

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


export async function getServerSideProps({ params, res }) {
  try {
    const db = getSupabaseAdmin();
    const id = String(params.id);
    const now = new Date().toISOString();

    const { data: manual, error: manualError } = await db
      .from("vacancies")
      .select("*")
      .eq("id", id)
      .eq("status", "approved")
      .or("expires_at.is.null,expires_at.gt." + now)
      .maybeSingle();

    if (manualError) throw manualError;

    if (manual && isUnexpired(manual)) {
      const job = toPublicVacancy(manual);
      job.datePosted = manual.published_at || null;
      job.seoCity = manual.city || null;
      job.seoState = manual.state || null;
      job.seoEligible = Boolean(
        manual.description && manual.published_at &&
        manual.city && manual.company_name && manual.job_title
      );
      return { props: { job } };
    }

    const { data: external, error: externalError } = await db
      .from("external_vacancies")
      .select("id,source,posted_at,company_name,job_title,location,work_mode,application_url")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (externalError) throw externalError;

    if (!external) return { notFound: true };

    let validUrl = false;
    try {
      const url = new URL(external.application_url);
      validUrl = url.protocol === "https:" &&
        !url.username && !url.password;
    } catch {}

    if (!validUrl) return { notFound: true };

    const job = toPublicVacancy({
      id: external.id,
      source: external.source,
      company_name: external.company_name,
      job_title: external.job_title,
      city: external.location,
      work_mode: external.work_mode,
      application_method: "external_url",
      application_value: external.application_url,
      published_at: external.posted_at,
      is_vip: false,
    });

    job.seoEligible = false;
    return { props: { job } };
  } catch (error) {
    console.error("Job SSR failed:", error.message);
    res.statusCode = 503;
    return { props: { job: null } };
  }
}

export default function JobDetails({ job }) {
  const canonical = job
    ? "https://chambaleo.net/vacantes/" + encodeURIComponent(job.id)
    : "https://chambaleo.net/";

  const title = job
    ? job.title + " en " + job.company + " | Chambaleo"
    : "Vacante no disponible | Chambaleo";

  const description = job
    ? (job.description || (
        "Encuentra la vacante de " + job.title +
        " en " + job.company + ", " + job.city + "."
      )).slice(0, 155)
    : "Explora empleos disponibles en México.";

  const schema = job?.seoEligible ? {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: "<p>" + String(job.description)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\n/g, "<br/>") + "</p>",
    datePosted: job.datePosted,
    hiringOrganization: {
      "@type": "Organization",
      name: job.company
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.seoCity,
        ...(job.seoState
          ? { addressRegion: job.seoState }
          : {}),
        addressCountry: "MX"
      }
    },
    url: canonical
  } : null;

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
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        {!job.seoEligible && (
          <meta name="robots" content="noindex,follow" />
        )}
        {schema && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(schema).replace(/</g, "\\u003c")
            }}
          />
        )}
      </Head>
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
              <p>{job.description || (job.dataAttribution ? "Consulta la publicación original para conocer todos los detalles." : `En ${job.company} buscamos personas con talento que quieran crecer y hacer la diferencia. Súmate a nuestro equipo y construyamos algo increíble.`)}</p>
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
            <div className="detail-disclaimer">
              Vacante revisada por Chambaleo. Las condiciones y el proceso de selección son responsabilidad de la empresa que publica.
              {job.dataAttribution && <> <a href={job.dataAttribution.url} target="_blank" rel="noreferrer">{job.dataAttribution.text}</a></>}
            </div>
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

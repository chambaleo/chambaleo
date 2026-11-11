import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function Logo() {
  return (
    <Link className="brand" href="/" aria-label="Chambaleo, inicio">
      <img className="brand-mark" src="/leo.png" alt="" width="31" height="31" />
      <span>chambaleo<span className="brand-period">.</span></span>
    </Link>
  );
}

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18m-12 0v2h6v-2" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function JobLogo({ job, large = false }) {
  return <span className={`company-logo${large ? " company-logo-large" : ""}`}>
    <svg className="company-logo-default" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4M8 7h1m6 0h1M8 11h1m6 0h1" /></svg>
    {job.logoUrl && <img className="company-logo-image" src={job.logoUrl} alt={`${job.company}`} />}
  </span>;
}

function FeaturedCard({ job }) {
  return (
    <Link className="featured-card" href={`/vacantes/${job.id}`}>
      <div className="featured-card-top">
        <JobLogo job={job} />
        <span className="featured-badge"><Icon name="spark" size={14} /> VACANTE VIP</span>
      </div>
      <h3>{job.title}</h3>
      <p className="featured-company">{job.company}</p>
      <div className="job-tags"><span>{job.mode}</span><span>{job.category}</span></div>
      <div className="featured-card-bottom">
        <span>{job.city}</span>
        <span className="card-arrow"><Icon name="arrow" size={17} /></span>
      </div>
    </Link>
  );
}

function JobRow({ job }) {
  return (
    <Link className="job-row" href={`/vacantes/${job.id}`}>
      <JobLogo job={job} />
      <span className="job-row-content">
        <span className="job-row-title">{job.title}</span>
        <span className="job-row-company">{job.company}</span>
      </span>
      <span className="job-row-location"><Icon name="pin" size={15} />{job.city}</span>
      <span className="job-row-date">{job.posted}</span>
      <span className="row-chevron"><Icon name="arrow" size={17} /></span>
    </Link>
  );
}

export default function Home() {
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsError, setJobsError] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [city, setCity] = useState("");
  const [search, setSearch] = useState({ title: "", company: "", city: "" });
  useEffect(() => {
    let active = true;
    fetch("/api/vacantes")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        return result;
      })
      .then((vacancies) => {
        if (active) setJobs(Array.isArray(vacancies) ? vacancies : []);
      })
      .catch(() => {
        if (active) setJobsError(true);
      })
      .finally(() => {
        if (active) setLoadingJobs(false);
      });
    return () => { active = false; };
  }, []);
  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const matches = (value, query) => !query || value.toLowerCase().includes(query.toLowerCase());
    return matches(job.title, search.title) && matches(job.company, search.company) && matches(job.city, search.city);
  }), [search]);
  const filteredFeatured = filteredJobs.filter((job) => job.featured);
  const regularJobs = filteredJobs.filter((job) => !job.featured);

  function submitSearch(event) {
    event.preventDefault();
    setSearch({ title: title.trim(), company: company.trim(), city: city.trim() });
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Logo />
          <nav className="header-nav" aria-label="Navegación principal">
            <a className="nav-link" href="#vacantes">Explorar empleos</a>
            <Link className="post-link" href="/publicar-vacante">Publicar vacante <Icon name="arrow" size={17} /></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <span className="hero-orb hero-orb-one" aria-hidden="true" />
          <span className="hero-orb hero-orb-two" aria-hidden="true" />
          <span className="hero-squiggle" aria-hidden="true">✳</span>
          <div className="hero-content">
            <div className="hero-eyebrow"><span /> EL SIGUIENTE PASO EMPIEZA AQUÍ</div>
            <h1>Tu próximo trabajo<br />te está <span>esperando.</span></h1>
            <p>Encuentra oportunidades que van contigo. Tu talento merece un gran lugar.</p>
            <form className="search-panel" onSubmit={submitSearch}>
              <label className="search-field">
                <Icon name="search" />
                <span className="sr-only">Puesto o palabra clave</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Puesto o palabra clave" />
              </label>
              <span className="search-divider" />
              <label className="search-field">
                <Icon name="briefcase" />
                <span className="sr-only">Empresa</span>
                <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Empresa" />
              </label>
              <span className="search-divider" />
              <label className="search-field">
                <Icon name="pin" />
                <span className="sr-only">Ciudad o estado</span>
                <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ciudad o estado" />
              </label>
              <button className="search-button" type="submit"><Icon name="search" size={18} /><span>Buscar empleos</span></button>
            </form>
            <div className="hero-search-hint">Prueba con <button type="button" onClick={() => { setTitle("Diseñador"); setSearch({ title: "Diseñador", company: "", city: "" }); }}>Diseñador</button>, <button type="button" onClick={() => { setTitle(""); setCity("Ciudad de México"); setSearch({ title: "", company: "", city: "Ciudad de México" }); }}>Ciudad de México</button> o <button type="button" onClick={() => { setTitle(""); setCompany("Kavak"); setSearch({ title: "", company: "Kavak", city: "" }); }}>Kavak</button></div>
          </div>
          <div className="hero-note" aria-hidden="true"><span>✦</span> Un buen trabajo<br />cambia todo.</div>
        </section>

        <section className="home-content" id="vacantes">
          <div className="section-heading">
            <div>
              <div className="section-kicker"><span className="kicker-star">✳</span> OPORTUNIDADES QUE BRILLAN</div>
              <h2>Vacantes <span>VIP</span></h2>
              <p>Empresas increíbles buscando talento como el tuyo.</p>
            </div>
            <a className="see-all" href="#todas">Ver todas las vacantes <Icon name="arrow" size={18} /></a>
          </div>

          {loadingJobs ? <div className="empty-featured">Cargando vacantes VIP…</div> : jobsError ? <div className="empty-featured">No fue posible cargar las vacantes. Inténtalo de nuevo más tarde.</div> : filteredFeatured.length ? (
            <div className="featured-grid">{filteredFeatured.map((job) => <FeaturedCard key={job.id} job={job} />)}</div>
          ) : (
            <div className="empty-featured">No encontramos vacantes VIP con esos filtros. Prueba con otra búsqueda.</div>
          )}

          <div className="regular-heading" id="todas">
            <div>
              <div className="section-kicker">MÁS OPORTUNIDADES</div>
              <h2>Empleos recientes</h2>
            </div>
            <span className="result-count">{filteredJobs.length} vacantes</span>
          </div>
          <div className="job-list">
            {loadingJobs ? <div className="empty-jobs">Cargando vacantes…</div> : regularJobs.length ? regularJobs.map((job) => <JobRow key={job.id} job={job} />) : (
              <div className="empty-jobs">No encontramos empleos recientes con esos filtros.</div>
            )}
          </div>
          <div className="bottom-cta">
            <div className="bottom-cta-icon"><Icon name="spark" size={23} /></div>
            <div><strong>¿Buscas algo más específico?</strong><span>Publica tu perfil y deja que las empresas te encuentren.</span></div>
            <a href="/publicar-vacante">Conoce Chambaleo <Icon name="arrow" size={17} /></a>
          </div>
        </section>
      </main>
      <footer className="site-footer"><Logo /><span>Hecho para que encuentres tu siguiente gran oportunidad. <b>♥</b></span><small>© 2026 Chambaleo · México</small></footer>
    </>
  );
}

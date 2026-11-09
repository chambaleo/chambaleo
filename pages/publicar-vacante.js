import Link from "next/link";

function Logo() {
  return <Link className="brand" href="/" aria-label="Chambaleo, inicio"><img className="brand-mark" src="/leo.png" alt="" width="31" height="31" /><span>chambaleo<span className="brand-period">.</span></span></Link>;
}

export default function PublicarVacante() {
  return (
    <>
      <header className="site-header"><div className="header-inner"><Logo /><nav className="header-nav" aria-label="Navegación principal"><Link className="nav-link" href="/">Explorar empleos</Link><span className="post-link post-link-current">Publicar vacante</span></nav></div></header>
      <main className="publish-page">
        <div className="publish-decoration publish-decoration-one" aria-hidden="true" />
        <div className="publish-decoration publish-decoration-two" aria-hidden="true" />
        <div className="publish-content">
          <span className="publish-icon" aria-hidden="true"><img className="publish-logo" src="/leo.png" alt="" width="40" height="42" /></span>
          <div className="section-kicker">CRECE CON CHAMBALEO</div>
          <h1>Tu próximo gran<br />talento está <span>por aquí.</span></h1>
          <p>Estamos preparando un espacio para conectar a grandes empresas con el talento que las llevará más lejos.</p>
          <span className="coming-soon-pill"><i /> Próximamente</span>
          <Link className="primary-button" href="/">Explorar vacantes <span>→</span></Link>
        </div>
        <div className="publish-bottom-note">Publicar una vacante será muy fácil. <span>♥</span></div>
      </main>
      <footer className="site-footer"><Logo /><span>Hecho para que encuentres tu siguiente gran oportunidad. <b>♥</b></span><small>© 2026 Chambaleo · México</small></footer>
    </>
  );
}

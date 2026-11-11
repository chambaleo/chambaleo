import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { detectCompanyLogoMime, MAX_COMPANY_LOGO_BYTES } from "../lib/companyLogo";

const APPLICATION_METHODS = ["email", "whatsapp", "external_url"];
const EMPLOYMENT_TYPES = ["Tiempo completo", "Medio tiempo", "Temporal", "Prácticas", "Freelance"];
const EXPERIENCE_LEVELS = ["Sin experiencia", "Junior", "Intermedio", "Senior"];
const SALARY_PERIODS = ["Mensual", "Semanal", "Diario", "Por hora"];
const VACANCY_CATEGORIES = [
  "Administración", "Ventas", "Marketing", "Tecnología", "Finanzas", "Educación", "Salud",
  "Logística", "Industria", "Construcción", "Turismo", "Atención al cliente", "Otros",
];

function Logo() {
  return <Link className="brand" href="/" aria-label="Chambaleo, inicio"><img className="brand-mark" src="/leo.png" alt="" width="31" height="31" /><span>chambaleo<span className="brand-period">.</span></span></Link>;
}

export default function PublicarVacante() {
  const [values, setValues] = useState({
    company_name: "", company_email: "", company_phone: "", job_title: "", category: "",
    city: "", state: "", work_mode: "Presencial", employment_type: "Tiempo completo",
    experience_level: "Sin experiencia", vacancy_count: "", salary_min: "", salary_max: "",
    salary_period: "Mensual", salary_negotiable: false, description: "", responsibilities: "",
    requirements: "", benefits: "", application_method: "email", application_value: "",
  });
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [errors, setErrors] = useState({});
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState(null);
  const logoInputRef = useRef(null);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  function updateField(event) {
    const { name, value, type, checked } = event.target;
    setValues((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function selectLogo(event) {
    const file = event.target.files?.[0] || null;
    setErrors((current) => ({ ...current, company_logo: undefined }));
    setSelectedLogo(null);
    setLogoPreview("");
    if (!file) return;
    if (file.size > MAX_COMPANY_LOGO_BYTES) {
      event.target.value = "";
      setErrors((current) => ({ ...current, company_logo: "El logotipo no puede superar 1 MB." }));
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      event.target.value = "";
      setErrors((current) => ({ ...current, company_logo: "El logotipo debe ser PNG, JPG o WEBP." }));
      return;
    }
    const actualMime = detectCompanyLogoMime(await file.slice(0, 12).arrayBuffer());
    if (actualMime !== file.type) {
      event.target.value = "";
      setErrors((current) => ({ ...current, company_logo: "El contenido del logotipo no coincide con su formato." }));
      return;
    }
    setSelectedLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    setSelectedLogo(null);
    setLogoPreview("");
    setErrors((current) => ({ ...current, company_logo: undefined }));
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  function fieldError(name) {
    return errors[name] ? <span className="field-error">{errors[name]}</span> : null;
  }

  async function submitVacancy(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setSubmission(null);
    try {
      let companyLogo = null;
      let logoReadError = null;
      if (selectedLogo) {
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
            reader.readAsDataURL(selectedLogo);
          });
          companyLogo = { mimeType: selectedLogo.type, data: String(dataUrl).split(",")[1] };
        } catch {
          logoReadError = "No se pudo leer el logotipo. La vacante se enviará sin él.";
        }
      }
      const response = await fetch("/api/vacantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, consent_accepted: consentAccepted, company_logo: companyLogo }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.fields) setErrors(result.fields);
        setSubmission({ error: result.error || "No pudimos enviar tu vacante. Inténtalo de nuevo." });
        return;
      }
      setSubmission({ message: result.message, id: result.id, logoError: result.logoError || logoReadError });
    } catch {
      setSubmission({ error: "No se pudo conectar con Chambaleo. Revisa tu conexión e inténtalo de nuevo." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="site-header"><div className="header-inner"><Logo /><nav className="header-nav" aria-label="Navegación principal"><Link className="nav-link" href="/">Explorar empleos</Link><span className="post-link post-link-current">Publicar vacante</span></nav></div></header>
      <main className="publish-page submission-page">
        <div className="publish-decoration publish-decoration-one" aria-hidden="true" />
        <div className="publish-decoration publish-decoration-two" aria-hidden="true" />
        <div className="submission-content">
          <div className="submission-heading">
            <span className="publish-icon" aria-hidden="true"><img className="publish-logo" src="/leo.png" alt="" width="40" height="42" /></span>
            <div className="section-kicker">CRECE CON CHAMBALEO</div>
            <h1>Publica una vacante<br /><span>y encuentra talento.</span></h1>
            <p>Sin registro ni costo inicial. Todas las vacantes se revisan antes de publicarse.</p>
          </div>

          {submission && <div className={`submission-unavailable${submission.error ? " submission-error" : " submission-success"}`} role="status">
            {submission.error || <>{submission.message} Tu folio es <strong>{submission.id}</strong>.{submission.logoError && <><br />{submission.logoError}</>}</>}
          </div>}

          <form className="vacancy-form" onSubmit={submitVacancy} noValidate>
            <section className="form-section">
              <div className="form-section-heading"><span>01</span><div><h2>Datos de la empresa</h2><p>Cuéntanos quién está contratando.</p></div></div>
              <div className="form-grid">
                <label className="form-field">Nombre de la empresa <b>*</b><input name="company_name" value={values.company_name} onChange={updateField} maxLength="120" autoComplete="organization" aria-invalid={Boolean(errors.company_name)} />{fieldError("company_name")}</label>
                <label className="form-field">Correo electrónico de contacto <b>*</b><input type="email" name="company_email" value={values.company_email} onChange={updateField} maxLength="254" autoComplete="email" aria-invalid={Boolean(errors.company_email)} />{fieldError("company_email")}</label>
                <label className="form-field">Teléfono / WhatsApp <span>Opcional</span><input type="tel" name="company_phone" value={values.company_phone} onChange={updateField} maxLength="32" autoComplete="tel" aria-invalid={Boolean(errors.company_phone)} />{fieldError("company_phone")}</label>
                <div className="company-logo-upload">
                  <label className="form-field" htmlFor="company-logo">Logotipo <span>Opcional · PNG, JPG o WEBP · máximo 1 MB</span><input ref={logoInputRef} id="company-logo" type="file" accept="image/png,image/jpeg,image/webp,.jpg,.jpeg" onChange={selectLogo} aria-invalid={Boolean(errors.company_logo)} /></label>
                  {logoPreview && <div className="company-logo-preview-wrap"><img className="company-logo-preview" src={logoPreview} alt="Vista previa del logotipo de la empresa" /><button className="company-logo-remove" type="button" onClick={removeLogo}>Quitar logotipo</button></div>}
                  {fieldError("company_logo")}
                </div>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-heading"><span>02</span><div><h2>Información de la vacante</h2><p>Los campos con * son obligatorios.</p></div></div>
              <div className="form-grid">
                <label className="form-field">Título del puesto <b>*</b><input name="job_title" value={values.job_title} onChange={updateField} maxLength="140" aria-invalid={Boolean(errors.job_title)} />{fieldError("job_title")}</label>
                <label className="form-field">Categoría <b>*</b><select name="category" value={values.category} onChange={updateField} aria-invalid={Boolean(errors.category)}><option value="">Selecciona una categoría</option>{VACANCY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>{fieldError("category")}</label>
                <label className="form-field">Modalidad <b>*</b><select name="work_mode" value={values.work_mode} onChange={updateField}><option>Presencial</option><option>Híbrido</option><option>Remoto</option></select>{fieldError("work_mode")}</label>
                <label className="form-field">Tipo de empleo <b>*</b><select name="employment_type" value={values.employment_type} onChange={updateField}>{EMPLOYMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>{fieldError("employment_type")}</label>
                <label className="form-field">Experiencia <b>*</b><select name="experience_level" value={values.experience_level} onChange={updateField}>{EXPERIENCE_LEVELS.map((level) => <option key={level}>{level}</option>)}</select>{fieldError("experience_level")}</label>
                <label className="form-field">Número de vacantes <span>Opcional</span><input type="number" name="vacancy_count" value={values.vacancy_count} onChange={updateField} min="1" max="10000" step="1" aria-invalid={Boolean(errors.vacancy_count)} />{fieldError("vacancy_count")}</label>
                <label className="form-field">Ciudad {values.work_mode === "Remoto" ? <span>Opcional para remoto nacional</span> : <b>*</b>}<input name="city" value={values.city} onChange={updateField} maxLength="100" aria-invalid={Boolean(errors.city)} /></label>
                <label className="form-field">Estado {values.work_mode === "Remoto" ? <span>Opcional</span> : <b>*</b>}<input name="state" value={values.state} onChange={updateField} maxLength="100" aria-invalid={Boolean(errors.state)} />{fieldError("city") || fieldError("state")}</label>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-heading"><span>03</span><div><h2>Salario</h2><p>Las cantidades se muestran en pesos mexicanos (MXN).</p></div></div>
              <div className="form-grid form-grid-salary">
                <label className="form-field">Salario mínimo<input type="number" name="salary_min" value={values.salary_min} onChange={updateField} min="0" step="0.01" inputMode="decimal" aria-invalid={Boolean(errors.salary_min)} />{fieldError("salary_min")}</label>
                <label className="form-field">Salario máximo<input type="number" name="salary_max" value={values.salary_max} onChange={updateField} min="0" step="0.01" inputMode="decimal" aria-invalid={Boolean(errors.salary_max)} />{fieldError("salary_max")}</label>
                <label className="form-field">Periodicidad <b>*</b><select name="salary_period" value={values.salary_period} onChange={updateField}>{SALARY_PERIODS.map((period) => <option key={period}>{period}</option>)}</select>{fieldError("salary_period")}</label>
                <label className="form-check form-negotiable"><input type="checkbox" name="salary_negotiable" checked={values.salary_negotiable} onChange={updateField} /><span>Salario a convenir</span></label>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-heading"><span>04</span><div><h2>Descripción</h2><p>Ayuda a las personas a entender el puesto y el equipo.</p></div></div>
              <div className="form-grid form-grid-single">
                <label className="form-field">Descripción del puesto <b>*</b><textarea name="description" value={values.description} onChange={updateField} rows="5" maxLength="10000" aria-invalid={Boolean(errors.description)} />{fieldError("description")}</label>
                <label className="form-field">Responsabilidades <b>*</b><textarea name="responsibilities" value={values.responsibilities} onChange={updateField} rows="4" maxLength="10000" aria-invalid={Boolean(errors.responsibilities)} />{fieldError("responsibilities")}</label>
                <label className="form-field">Requisitos <b>*</b><textarea name="requirements" value={values.requirements} onChange={updateField} rows="4" maxLength="10000" aria-invalid={Boolean(errors.requirements)} />{fieldError("requirements")}</label>
                <label className="form-field">Beneficios <span>Opcional</span><textarea name="benefits" value={values.benefits} onChange={updateField} rows="3" maxLength="10000" aria-invalid={Boolean(errors.benefits)} />{fieldError("benefits")}</label>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-heading"><span>05</span><div><h2>Cómo postularse</h2><p>Elige una sola vía para recibir postulaciones.</p></div></div>
              <div className="application-options" role="radiogroup" aria-label="Método para postularse">
                {APPLICATION_METHODS.map((method) => <label key={method} className={`application-option${values.application_method === method ? " is-selected" : ""}`}><input type="radio" name="application_method" value={method} checked={values.application_method === method} onChange={updateField} /><span>{method === "email" ? "Correo" : method === "whatsapp" ? "WhatsApp" : "Sitio externo"}</span></label>)}
              </div>
              <label className="form-field application-value-field">{values.application_method === "email" ? "Correo para postularse" : values.application_method === "whatsapp" ? "WhatsApp en formato internacional" : "URL de postulación HTTPS"} <b>*</b><input type={values.application_method === "email" ? "email" : "text"} name="application_value" value={values.application_value} onChange={updateField} placeholder={values.application_method === "email" ? "talento@empresa.mx" : values.application_method === "whatsapp" ? "+525512345678" : "https://empresa.mx/postulacion"} aria-invalid={Boolean(errors.application_value)} />{fieldError("application_value")}</label>
            </section>

            <section className="form-section form-consent-section">
              <div className="form-section-heading"><span>06</span><div><h2>Consentimiento</h2><p>La vacante no será pública hasta que nuestro equipo la apruebe.</p></div></div>
              <label className="form-check"><input type="checkbox" name="consent_accepted" checked={consentAccepted} onChange={(event) => { setConsentAccepted(event.target.checked); setErrors((current) => ({ ...current, consent_accepted: undefined })); }} aria-invalid={Boolean(errors.consent_accepted)} /><span>Acepto el <Link href="/aviso-de-privacidad">aviso de privacidad</Link> y los <Link href="/terminos-de-uso">términos de uso</Link>. Confirmo que cuento con autorización para publicar esta información. <b>*</b></span></label>
              {fieldError("consent_accepted")}
              <div className="review-notice"><span>✓</span> Todas las vacantes se revisan antes de publicarse. Enviaremos cualquier seguimiento al correo de contacto.</div>
            </section>

            <button className="primary-button submit-vacancy-button" type="submit" disabled={submitting || Boolean(submission && !submission.error)}>
              {submitting ? "Enviando vacante…" : submission && !submission.error ? "Vacante enviada" : "Enviar vacante"}
            </button>
            <p className="form-footnote">Tu vacante permanecerá privada hasta que nuestro equipo la apruebe.</p>
          </form>
        </div>
      </main>
      <footer className="site-footer"><Logo /><span>Hecho para que encuentres tu siguiente gran oportunidad. <b>♥</b></span><small>© 2026 Chambaleo · México</small></footer>
    </>
  );
}

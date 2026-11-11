const EMPLOYMENT_TYPES = ["Tiempo completo", "Medio tiempo", "Temporal", "Prácticas", "Freelance"];
const EXPERIENCE_LEVELS = ["Sin experiencia", "Junior", "Intermedio", "Senior"];
const SALARY_PERIODS = ["Mensual", "Semanal", "Diario", "Por hora"];
const WORK_MODES = ["Presencial", "Híbrido", "Remoto"];
const APPLICATION_METHODS = ["email", "whatsapp", "external_url"];
const LIMITS = {
  company_name: 120, company_email: 254, company_phone: 32, job_title: 140, category: 80,
  city: 100, state: 100, description: 10000, responsibilities: 10000, requirements: 10000,
  benefits: 10000, application_value: 500,
};

const cleanText = (value) => typeof value === "string" ? value.trim() : "";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateVacancySubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: { form: "Revisa la información e inténtalo de nuevo." } };
  }

  const values = {};
  for (const [field, maxLength] of Object.entries(LIMITS)) {
    values[field] = cleanText(body[field]);
    if (values[field].length > maxLength) {
      return { errors: { [field]: `Este campo no puede superar ${maxLength} caracteres.` } };
    }
  }

  const errors = {};
  for (const field of ["company_name", "company_email", "job_title", "category", "description", "responsibilities", "requirements"]) {
    if (!values[field]) errors[field] = "Este campo es obligatorio.";
  }
  if (values.company_email && !emailPattern.test(values.company_email)) errors.company_email = "Escribe un correo electrónico válido.";
  if (!WORK_MODES.includes(body.work_mode)) errors.work_mode = "Selecciona una modalidad válida.";
  if (!EMPLOYMENT_TYPES.includes(body.employment_type)) errors.employment_type = "Selecciona un tipo de empleo válido.";
  if (!EXPERIENCE_LEVELS.includes(body.experience_level)) errors.experience_level = "Selecciona un nivel de experiencia válido.";
  if (!SALARY_PERIODS.includes(body.salary_period)) errors.salary_period = "Selecciona una periodicidad válida.";
  if (!APPLICATION_METHODS.includes(body.application_method)) errors.application_method = "Selecciona una vía de postulación válida.";
  if (body.work_mode !== "Remoto" && !values.city) errors.city = "Indica la ciudad para esta modalidad.";
  if (body.work_mode !== "Remoto" && !values.state) errors.state = "Indica el estado para esta modalidad.";
  if (body.consent_accepted !== true) errors.consent_accepted = "Debes aceptar el aviso de privacidad y los términos.";

  const applicationValue = values.application_value;
  if (!applicationValue) errors.application_value = "Indica cómo postularse.";
  else if (body.application_method === "email" && !emailPattern.test(applicationValue)) errors.application_value = "Escribe un correo electrónico válido.";
  else if (body.application_method === "whatsapp" && !/^\+[1-9]\d{7,14}$/.test(applicationValue)) errors.application_value = "Usa el formato internacional, por ejemplo +525512345678.";
  else if (body.application_method === "external_url") {
    try {
      if (new URL(applicationValue).protocol !== "https:") throw new Error();
    } catch {
      errors.application_value = "Escribe una URL segura que comience con https://.";
    }
  }

  const numericFields = ["salary_min", "salary_max", "vacancy_count"];
  for (const field of numericFields) {
    const raw = body[field];
    values[field] = raw === "" || raw == null ? null : Number(raw);
    if (values[field] != null && (!Number.isFinite(values[field]) || values[field] < 0)) {
      errors[field] = "Escribe una cantidad válida mayor o igual a cero.";
    }
  }
  if (values.vacancy_count != null && (!Number.isInteger(values.vacancy_count) || values.vacancy_count < 1 || values.vacancy_count > 10000)) {
    errors.vacancy_count = "Indica entre 1 y 10,000 vacantes.";
  }
  if (values.salary_min != null && values.salary_max != null && values.salary_max < values.salary_min) {
    errors.salary_max = "El salario máximo debe ser igual o mayor al mínimo.";
  }
  if (Object.keys(errors).length) return { errors };

  return {
    data: {
      company_name: values.company_name,
      company_email: values.company_email.toLowerCase(),
      company_phone: values.company_phone || null,
      job_title: values.job_title,
      category: values.category,
      city: values.city || null,
      state: values.state || null,
      work_mode: body.work_mode,
      employment_type: body.employment_type,
      experience_level: body.experience_level,
      vacancy_count: values.vacancy_count,
      salary_min: values.salary_min,
      salary_max: values.salary_max,
      salary_period: body.salary_period,
      salary_negotiable: body.salary_negotiable === true,
      description: values.description,
      responsibilities: values.responsibilities,
      requirements: values.requirements,
      benefits: values.benefits || null,
      application_method: body.application_method,
      application_value: applicationValue,
      company_logo_url: null,
      status: "pending",
      is_vip: false,
    },
  };
}
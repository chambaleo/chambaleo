const PUBLIC_FIELDS = [
  "id", "company_name", "job_title", "category", "city", "state", "work_mode",
  "employment_type", "experience_level", "vacancy_count", "salary_min", "salary_max",
  "salary_period", "salary_negotiable", "description", "responsibilities", "requirements",
  "benefits", "application_method", "application_value", "is_vip", "published_at", "expires_at",
  "company_logo_url",
];

export function toPublicVacancy(row, logoUrl = null) {
  const vacancy = Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, row[field] ?? null]));
  const salaryMin = vacancy.salary_min == null || vacancy.salary_min === "" ? Number.NaN : Number(vacancy.salary_min);
  const salaryMax = vacancy.salary_max == null || vacancy.salary_max === "" ? Number.NaN : Number(vacancy.salary_max);
  const currency = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  const salary = vacancy.salary_negotiable || (!Number.isFinite(salaryMin) && !Number.isFinite(salaryMax))
    ? "A convenir"
    : `${Number.isFinite(salaryMin) ? `$${currency.format(salaryMin)}` : ""}${Number.isFinite(salaryMin) && Number.isFinite(salaryMax) ? " – " : ""}${Number.isFinite(salaryMax) ? `$${currency.format(salaryMax)}` : ""} MXN${vacancy.salary_period ? ` · ${vacancy.salary_period.toLowerCase()}` : ""}`;
  const city = [vacancy.city, vacancy.state].filter(Boolean).join(", ") || "México";
  const age = vacancy.published_at ? Math.max(0, Date.now() - new Date(vacancy.published_at).getTime()) : 0;
  const units = [["day", 86400000], ["hour", 3600000], ["minute", 60000]];
  const [unit, duration] = units.find(([, ms]) => age >= ms) || ["minute", 60000];
  const posted = vacancy.published_at
    ? new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" }).format(-Math.floor(age / duration), unit)
    : "Recientemente";
  const colors = ["lilac", "mint", "blue", "orange", "pink", "navy", "yellow"];
  const colorIndex = [...String(vacancy.id)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length;

  return {
    id: vacancy.id,
    title: vacancy.job_title || "Vacante",
    company: vacancy.company_name || "Empresa",
    city,
    mode: vacancy.work_mode || "",
    type: vacancy.employment_type || "",
    salary,
    category: vacancy.category || "",
    posted,
    logoUrl,
    color: colors[colorIndex],
    featured: Boolean(vacancy.is_vip),
    description: vacancy.description || "",
    responsibilities: vacancy.responsibilities || "",
    requirements: vacancy.requirements || "",
    benefits: vacancy.benefits || "",
    experience: vacancy.experience_level || "",
    vacancyCount: vacancy.vacancy_count,
    applicationMethod: vacancy.application_method || "",
    applicationValue: vacancy.application_value || "",
    expiresAt: vacancy.expires_at,
  };
}

export function isUnexpired(row, now = Date.now()) {
  return !row.expires_at || new Date(row.expires_at).getTime() > now;
}
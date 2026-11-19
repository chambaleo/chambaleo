import { getSupabaseAdmin } from "../lib/supabaseServer";

const BASE = "https://chambaleo.net";

export async function getServerSideProps({ res }) {
  try {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const ids = new Set();

    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db
        .from("vacancies")
        .select("id,description,published_at,city,company_name,job_title")
        .eq("status", "approved")
        .or("expires_at.is.null,expires_at.gt." + now)
        .range(offset, offset + 499);

      if (error) throw error;
      for (const row of data || []) {
        if (row.id && row.description && row.published_at && row.city && row.company_name && row.job_title) ids.add(String(row.id));
      }
      if (!data || data.length < 500) break;
    }

    const urls = [BASE + "/"];
    for (const id of ids) {
      urls.push(BASE + "/vacantes/" + encodeURIComponent(id));
    }

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map(url => "<url><loc>" + url + "</loc></url>").join("") +
      "</urlset>";

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900");
    res.end(xml);
  } catch (error) {
    console.error("Sitemap generation failed:", error.message);
    res.statusCode = 503;
    res.end("Sitemap temporarily unavailable");
  }

  return { props: {} };
}

export default function Sitemap() {
  return null;
}

import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "chambaleo",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],

    workersDev: false,
    previewUrls: false,

    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: [
        "/*",
        "!/_next/static/*",
        "!//_next/static/",
      ],
    },

    env: {
      ASSETS: bindings.assets(),

      NEXT_PUBLIC_SUPABASE_URL: bindings.secret(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: bindings.secret(),
      SUPABASE_URL: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
    },
  }),
});

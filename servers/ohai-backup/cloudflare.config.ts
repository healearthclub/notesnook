import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode = "development" }) => {
  if (!["development", "staging", "production"].includes(mode)) {
    throw new Error("Choose development, staging, or production.");
  }
  const local = mode === "development";
  const label = local ? "local" : mode;
  const suffix = mode.toUpperCase();
  const id = local ? "a11163cd-494d-41fc-85c0-0a7b8f8d9930" : process.env[`OHAI_D1_ID_${suffix}`];
  const origin = local
    ? process.env.OHAI_APP_ORIGIN_DEVELOPMENT || "http://localhost:8787"
    : process.env[`OHAI_APP_ORIGIN_${suffix}`];
  const googleClientId = process.env[`OHAI_GOOGLE_CLIENT_ID_${suffix}`];
  const googleAllowedEmails = process.env[`OHAI_GOOGLE_ALLOWED_EMAILS_${suffix}`];
  if (!local && (!id?.match(/^[0-9a-f-]{36}$/) || !origin?.startsWith("https://"))) {
    throw new Error(`Set the dedicated OHAI_D1_ID_${suffix} and HTTPS OHAI_APP_ORIGIN_${suffix}.`);
  }
  if (!local && process.env.OHAI_D1_ID_STAGING === process.env.OHAI_D1_ID_PRODUCTION) {
    throw new Error("Staging and production require different D1 databases.");
  }

  return {
    worker: {
      name: `ohai-backup-${label}`,
      entrypoint,
      compatibilityDate: "2026-05-15",
      env: {
        DB: bindings.d1({
          name: `ohai-backup-${label}`,
          id,
          dev: { remote: false }
        }),
        BACKUPS: bindings.r2({ name: `ohai-backup-${label}`, dev: { remote: false } }),
        APP_ORIGIN: bindings.text(origin!),
        GOOGLE_CLIENT_ID: googleClientId ? bindings.text(googleClientId) : undefined,
        GOOGLE_CLIENT_SECRET: googleClientId ? bindings.secret() : undefined,
        GOOGLE_ALLOWED_EMAILS: googleAllowedEmails ? bindings.text(googleAllowedEmails) : undefined,
        IOS_APP_ID: process.env[`OHAI_IOS_APP_ID_${suffix}`]
          ? bindings.text(process.env[`OHAI_IOS_APP_ID_${suffix}`]!)
          : undefined,
        GOOGLE_PUBLIC_SIGNUP: bindings.text("false")
      },
      triggers: [triggers.scheduled({ schedule: "*/10 * * * *" })]
    }
  };
});

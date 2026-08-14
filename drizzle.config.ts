/**
 * Configurazione di drizzle-kit per le migrazioni di Netlify DB.
 *
 * Volutamente senza `import { defineConfig } from "drizzle-kit"`: in fase di
 * deploy il comando viene eseguito tramite npx, quindi questo file può essere
 * letto da una copia di drizzle-kit esterna al progetto e l'import non sarebbe
 * risolvibile ("Cannot find module 'drizzle-kit'"). `defineConfig` è solo una
 * funzione identità che aggiunge i tipi, quindi l'oggetto va bene così com'è.
 */

export default {
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "netlify/database/migrations",
};

/**
 * Trigger di Netlify Forms: viene chiamato automaticamente a ogni iscrizione
 * verificata (il nome del file deve restare "submission-created").
 *
 * Manda alla casella dell'azienda l'avviso di una nuova iscrizione alla lista
 * d'attesa. L'invio passa dallo stesso canale Resend usato per le prenotazioni:
 * se RESEND_API_KEY non è configurata l'iscrizione resta comunque salvata su
 * Netlify Forms e qui viene solo registrato un avviso nei log.
 */

import { COMPANY_EMAIL, sendEmail } from "../../lib/notify.js";

interface SubmissionPayload {
  form_name?: string;
  created_at?: string;
  data?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async (req: Request) => {
  let payload: SubmissionPayload;
  try {
    const body = (await req.json()) as { payload?: SubmissionPayload };
    payload = body.payload ?? {};
  } catch {
    console.warn("submission-created: corpo della richiesta non leggibile");
    return new Response("OK");
  }

  // Il trigger scatta per tutti i form del sito: qui ci interessa solo la lista d'attesa.
  if (payload.form_name && payload.form_name !== "lista-attesa") {
    return new Response("OK");
  }

  const nome = (payload.data?.nome || "").trim();
  const email = (payload.data?.email || "").trim();

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;">
  <h2 style="margin:0 0 4px;">Nuova iscrizione alla lista d'attesa</h2>
  <p style="margin:0 0 16px;color:#8a8a92;font-size:14px;">Arrivata dal sito rageroomcuneo</p>
  <table style="border-collapse:collapse;font-size:15px;">
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Nome</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(nome || "—")}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Email</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(email || "—")}</td></tr>
  </table>
  <p style="margin:20px 0 0;font-size:13px;color:#8a8a92;">
    Avvisa questa persona quando apri le prenotazioni.
  </p>
</div>`;

  try {
    await sendEmail(
      COMPANY_EMAIL,
      `Lista d'attesa: nuova iscrizione${nome ? ` — ${nome}` : ""}`,
      html,
      email || undefined,
    );
  } catch (error) {
    // Un errore qui non deve far risultare fallita l'iscrizione: è già salvata.
    console.error("submission-created: invio email non riuscito", error);
  }

  return new Response("OK");
};

// netlify/functions/stripe-webhook.js
//
// Riceve gli eventi da Stripe (es. pagamento completato) e conferma la prenotazione.
// Da registrare su Stripe Dashboard > Developers > Webhooks
// URL da inserire: https://rageroomcuneo.it/.netlify/functions/stripe-webhook

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Verifica firma webhook fallita:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    const { roomType, bookingDate, customerName } = session.metadata;
    const customerEmail = session.customer_email;

    console.log('Prenotazione confermata:', {
      roomType,
      bookingDate,
      customerName,
      customerEmail,
      amount: session.amount_total,
    });

    // TODO: qui va la logica per:
    // 1. Salvare la prenotazione confermata (es. nel tuo database/storage attuale)
    // 2. Inviare email di conferma al cliente via Resend
    // 3. Inviare notifica interna al manager (già presente nel sistema attuale)
    //
    // Esempio chiamata a Resend (adatta alla tua implementazione esistente):
    //
    // await fetch('https://api.resend.com/emails', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     from: 'Rage Room Cuneo <prenotazioni@rageroomcuneo.it>',
    //     to: customerEmail,
    //     subject: 'Prenotazione confermata - Rage Room Cuneo',
    //     html: `<p>Ciao ${customerName}, la tua prenotazione per il ${bookingDate} è confermata!</p>`,
    //   }),
    // });
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

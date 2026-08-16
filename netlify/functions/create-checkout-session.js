// netlify/functions/create-checkout-session.js
//
// Crea una sessione Stripe Checkout per una prenotazione Rage Room Cuneo.
// Chiamata dal frontend quando il cliente conferma data/stanza e clicca "Paga".

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Prezzi in centesimi (EUR). Aggiorna questi valori con i tuoi prezzi reali.
const ROOM_PRICES = {
  solo: 3000,      // es. 30,00 EUR - stanza solo
  duo: 5000,       // es. 50,00 EUR - stanza due persone
  group: 9000,     // es. 90,00 EUR - stanza gruppo
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { roomType, customerEmail, bookingDate, customerName } = JSON.parse(event.body);

    if (!roomType || !ROOM_PRICES[roomType]) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Tipo di stanza non valido' }),
      };
    }

    const amount = ROOM_PRICES[roomType];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Rage Room Cuneo - Stanza ${roomType}`,
              description: bookingDate ? `Prenotazione per il ${bookingDate}` : undefined,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      customer_email: customerEmail,
      metadata: {
        roomType,
        bookingDate: bookingDate || '',
        customerName: customerName || '',
      },
      success_url: `${process.env.URL}/prenotazione-confermata?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/prenotazione-annullata`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    console.error('Errore creazione sessione Stripe:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Errore durante la creazione del pagamento' }),
    };
  }
};

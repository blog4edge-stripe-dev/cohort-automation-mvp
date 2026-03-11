// services/paymentService.js

const { log } = require("../utils/logger");

async function handlePaymentSucceeded(event, client) {
  const paymentIntent = event.data.object;

  const paymentId = paymentIntent.id;
  const eventId = event.id;

/*   log("info", "Processing payment_intent.succeeded", {
    eventId,
    paymentIntentId: paymentId,
  });
 */

  console.log("Processing payment_intent.succeeded :", paymentId);
  const email =
    paymentIntent.receipt_email ||
    paymentIntent.charges?.data[0]?.billing_details?.email ||
    null;

  const amount = paymentIntent.amount;
  const currency = paymentIntent.currency;
  const stripeCustomerId = paymentIntent.customer || null;

  try {
    const result = await client.query(
      `
      INSERT INTO payments (
        id,
        stripe_event_id,
        email,
        amount,
        currency,
        stripe_customer_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
      `,
      [
        paymentId,
        eventId,
        email,
        amount,
        currency,
        stripeCustomerId
      ]
    );

    if (result.rowCount === 0) {
      log("warn", "Payment already exists (business idempotency hit)", {
        eventId,
        paymentIntentId: paymentId,
      });
    } else {
      console.log("Payment Stored Successfully :", paymentId);
    }

  } catch (error) {
    log("error", "Failed to insert payment", {
      eventId,
      paymentIntentId: paymentId,
      error: error.message,
    });

    // IMPORTANT: rethrow so transaction rolls back
    throw error;
  }
}

module.exports = {
  handlePaymentSucceeded,
};
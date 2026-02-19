const pool = require("../db");

async function handlePaymentSucceeded(event) {
  const paymentIntent = event.data.object;

  const paymentId = paymentIntent.id;
  const email =
    paymentIntent.receipt_email ||
    paymentIntent.charges?.data[0]?.billing_details?.email;

  const amount = paymentIntent.amount;
  const currency = paymentIntent.currency;
  const stripeCustomerId = paymentIntent.customer;

  await pool.query(
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
    `,
    [
      paymentId,
      event.id,
      email,
      amount,
      currency,
      stripeCustomerId
    ]
  );

  console.log("💾 Payment stored:", paymentId);
}

module.exports = {
  handlePaymentSucceeded,
};

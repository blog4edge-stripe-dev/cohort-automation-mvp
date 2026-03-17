// services/paymentService.js

const { logSubscriptionAudit } = require("../utils/logger");

async function handlePaymentSucceeded(event, client) {

  const paymentIntent = event.data.object;

  // 1️⃣ Get invoice → subscription
  const invoiceId = paymentIntent.invoice;

  const invoice = await require("stripe")(process.env.STRIPE_SECRET_KEY)
    .invoices.retrieve(invoiceId);

  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    console.log("No subscription linked to this payment");
    return;
  }

  // 2️⃣ Ensure subscription exists (CRITICAL for ordering)
  
  await client.query(`
    INSERT INTO subscriptions (id, status)
    VALUES ($1, 'pending')
    ON CONFLICT (id) DO NOTHING
  `, [subscriptionId]);

  // 3️⃣ Fetch BEFORE state
  const beforeResult = await client.query(
    `SELECT status, expires_at, plan_id FROM subscriptions WHERE id=$1`,
    [subscriptionId]
  );

  const before = beforeResult.rows[0];

  // 4️⃣ Update subscription
  const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await client.query(
    `
    UPDATE subscriptions
    SET status='active',
        expires_at=$1,
        updated_at=NOW()
    WHERE id=$2
    `,
    [newExpiry, subscriptionId]
  );

  // 5️⃣ Fetch AFTER state
  const afterResult = await client.query(
    `SELECT status, expires_at, plan_id FROM subscriptions WHERE id=$1`,
    [subscriptionId]
  );

  const after = afterResult.rows[0];

  // 6️⃣ Write audit log
  await logSubscriptionAudit(client, {
    subscriptionId,
    actor: "webhook",
    action: "status_change",
    reason: "PAYMENT_SUCCESS",
    before,
    after,
    metadata: {
      eventId: event.id,
      provider: "stripe"
    }
  });

}

module.exports = {
  handlePaymentSucceeded,
};
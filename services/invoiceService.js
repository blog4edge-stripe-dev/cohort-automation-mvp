const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { logSubscriptionAudit } = require("../utils/logger");

async function handleInvoicePaymentSucceeded(event, client) {

  const invoice = event.data.object;

  console.log("Processing invoice.payment_succeeded:", invoice.id);

  // 🚨 Only process subscription invoices
  if (!invoice.subscription) {
    console.log("Skipping: Not a subscription invoice");
    return;
  }

  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  // 1️⃣ Fetch latest subscription from Stripe (source of truth)
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const newState = {
    subscription_id: subscription.id,
    customer_id: subscription.customer,
    status: subscription.status,
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
    price_id: subscription.items.data[0].price.id,
  };

  // 2️⃣ Check existing subscription in DB
  const existing = await client.query(
    `SELECT * FROM subscriptions WHERE subscription_id = $1`,
    [subscriptionId]
  );

  let beforeState = null;

  if (existing.rowCount > 0) {
    beforeState = existing.rows[0];

    // 3️⃣ Update existing subscription
    await client.query(
      `
      UPDATE subscriptions
      SET status = $1,
          current_period_start = $2,
          current_period_end = $3,
          price_id = $4,
          updated_at = NOW()
      WHERE subscription_id = $5
      `,
      [
        newState.status,
        newState.current_period_start,
        newState.current_period_end,
        newState.price_id,
        subscriptionId
      ]
    );

    console.log("Subscription updated:", subscriptionId);

  } else {

    // 4️⃣ Create subscription (handles out-of-order events)
    await client.query(
      `
      INSERT INTO subscriptions
      (subscription_id, customer_id, status, current_period_start, current_period_end, price_id, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      `,
      [
        newState.subscription_id,
        newState.customer_id,
        newState.status,
        newState.current_period_start,
        newState.current_period_end,
        newState.price_id
      ]
    );

    console.log("Subscription created (late arrival safe):", subscriptionId);
  }

  // 5️⃣ Audit log (VERY important for debugging + portfolio)
  await logSubscriptionAudit(client, {
    subscriptionId,
    actor: "stripe_webhook",
    action: existing.rowCount > 0 ? "UPDATED" : "CREATED",
    reason: "invoice.payment_succeeded",
    before: beforeState,
    after: newState,
    metadata: {
      invoice_id: invoice.id,
      event_id: event.id
    }
  });

}

module.exports = { handleInvoicePaymentSucceeded };
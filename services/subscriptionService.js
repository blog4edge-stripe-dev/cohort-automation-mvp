const { logSubscriptionAudit } = require("../utils/logger");

async function createSubscription(event, client) {

  const subscription = event.data.object;

  const subscriptionId = subscription.id;

  const expiresAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  // 1️⃣ Fetch BEFORE (may not exist)
  const beforeResult = await client.query(
    `SELECT status, expires_at, plan_id FROM subscriptions WHERE id=$1`,
    [subscriptionId]
  );

  const before = beforeResult.rows[0] || null;

  // 2️⃣ UPSERT (order-safe)
  await client.query(
    `
    INSERT INTO subscriptions (id, customer_id, plan_id, status, expires_at)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id)
    DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    `,
    [
      subscriptionId,
      subscription.customer,
      subscription.items.data[0].price.id,
      subscription.status,
      expiresAt
    ]
  );

  // 3️⃣ Fetch AFTER
  const afterResult = await client.query(
    `SELECT status, expires_at, plan_id FROM subscriptions WHERE id=$1`,
    [subscriptionId]
  );

  const after = afterResult.rows[0];

  // 4️⃣ Audit log
  await logSubscriptionAudit(client, {
    subscriptionId,
    actor: "webhook",
    action: "subscription_created",
    reason: "STRIPE_EVENT",
    before,
    after,
    metadata: {
      eventId: event.id,
      provider: "stripe"
    }
  });

}

module.exports = { createSubscription };
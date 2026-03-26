async function createSubscription(event, client) {

  const subscription = event.data.object;
  const subscriptionId = subscription.id;

  if (!subscriptionId) {
    throw new Error("Missing subscription ID");
  }

  const expiresAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  const priceId = subscription.items?.data?.[0]?.price?.id || null;

  // BEFORE (optional lock for strict correctness)
  const beforeResult = await client.query(
    `SELECT status, expires_at, plan_id FROM subscriptions WHERE id=$1`,
    [subscriptionId]
  );

  const before = beforeResult.rows[0] || null;

  // UPSERT with RETURNING
  const upsertResult = await client.query(
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
    RETURNING status, expires_at, plan_id
    `,
    [
      subscriptionId,
      subscription.customer,
      priceId,
      subscription.status,
      expiresAt
    ]
  );

  const after = upsertResult.rows[0];

  await logSubscriptionAudit(client, {
    subscriptionId,
    actor: "webhook",
    action: before ? "UPDATED" : "CREATED",
    reason: "STRIPE_EVENT",
    before,
    after,
    metadata: {
      eventId: event.id,
      provider: "stripe"
    }
  });
}
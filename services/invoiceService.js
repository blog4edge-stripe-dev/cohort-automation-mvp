async function handleInvoicePaymentSucceeded(event, client) {

  const invoice = event.data.object;

  if (!invoice.subscription || typeof invoice.subscription !== "string") {
    console.log("Skipping: Not a subscription invoice", invoice.id);
    return;
  }

  const subscriptionId = invoice.subscription;

  // Fetch latest (optional but good)
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const priceId = subscription.items?.data?.[0]?.price?.id || null;

  const newState = {
    subscription_id: subscription.id,
    customer_id: subscription.customer,
    status: subscription.status,
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
    price_id: priceId,
  };

  // BEFORE
  const existing = await client.query(
    `SELECT * FROM subscriptions WHERE subscription_id = $1`,
    [subscriptionId]
  );

  const beforeState = existing.rows[0] || null;

  // UPSERT
  const result = await client.query(
    `
    INSERT INTO subscriptions
    (subscription_id, customer_id, status, current_period_start, current_period_end, price_id, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    ON CONFLICT (subscription_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      price_id = EXCLUDED.price_id,
      updated_at = NOW()
    RETURNING *
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

  const afterState = result.rows[0];

  const action = beforeState ? "UPDATED" : "CREATED";

  await logSubscriptionAudit(client, {
    subscriptionId,
    actor: "stripe_webhook",
    action,
    reason: "invoice.payment_succeeded",
    before: beforeState,
    after: afterState,
    metadata: {
      invoice_id: invoice.id,
      event_id: event.id
    }
  });

  console.log("Invoice processed:", event.id);
}
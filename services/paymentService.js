async function handlePaymentIntentSucceeded(event, client) {
  const paymentIntent = event.data.object;

  await client.query("BEGIN");

  try {

    // 1. Fetch latest (source of truth)
    const latest = await stripe.paymentIntents.retrieve(paymentIntent.id);

    const newState = {
      payment_intent_id: latest.id,
      amount: latest.amount,
      status: latest.status,
      customer_id: latest.customer
    };

    // 2. Upsert logic
    const existing = await client.query(
      `SELECT * FROM payments WHERE payment_intent_id = $1`,
      [latest.id]
    );

    if (existing.rowCount > 0) {
      await client.query(
        `UPDATE payments SET status = $1 WHERE payment_intent_id = $2`,
        [newState.status, latest.id]
      );
    } else {
      await client.query(
        `INSERT INTO payments (payment_intent_id, amount, status)
         VALUES ($1, $2, $3)`,
        [newState.payment_intent_id, newState.amount, newState.status]
      );
    }

    // 4. Audit
    await logPaymentAudit(client, {
      paymentIntentId: latest.id,
      action: existing.rowCount > 0 ? "UPDATED" : "CREATED",
      eventId: event.id
    });

    // 5. Mark processed
    await client.query(
      `INSERT INTO stripe_events (event_id) VALUES ($1)`,
      [event.id]
    );

    await client.query("COMMIT");

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
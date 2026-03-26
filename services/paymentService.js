async function handlePaymentIntentSucceeded(event, client) {
  const paymentIntent = event.data.object;

  try {

    // 1. Fetch latest (source of truth)
    const latest = await stripe.paymentIntents.retrieve(paymentIntent.id);

    const newState = {
      payment_intent_id: latest.id,
      amount: latest.amount,
      status: latest.status,
      customer_id: latest.customer
    };

    // 2. Upsert
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

    // 3. Audit
    await logPaymentAudit(client, {
      paymentIntentId: latest.id,
      action: existing.rowCount > 0 ? "UPDATED" : "CREATED",
      eventId: event.id
    });

    // ❌ REMOVE THIS (handled in index.js)
    // await client.query(`INSERT INTO stripe_events...`);

  } catch (err) {
    throw err; // let caller handle rollback
  }
}
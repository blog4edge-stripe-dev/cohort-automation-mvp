const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { logSubscriptionAudit } = require("../utils/logger");

async function handleInvoicePaymentSucceeded(event, client) {
  const invoice = event.data.object;

  console.log("Processing Event - invoice.payment_succeeded For Incvoice Id :", invoice.id);

/*   if (!invoice.subscription) {
    console.log("Skipping: Not a subscription invoice");
    return;
  } */

  const subscriptionId = invoice.subscription;

  // 🚨 START TRANSACTION
  await client.query("BEGIN");

  try {

    // ✅ 1. Fetch latest from Stripe (source of truth)
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Structured Data : think of this a variable with a fields and its values - similar to temptable in Progress 4gl ; newstate temptable and then fields like susbscription_id
    const newState = {
      subscription_id: subscription.id,
      customer_id: subscription.customer,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
      price_id: subscription.items.data[0].price.id,
    };

    // ✅ 3. Check existing
    const existing = await client.query(
      `SELECT * FROM subscriptions WHERE subscription_id = $1`,
      [subscriptionId]
    );

    let beforeState = null;
    let action = "CREATED";

    // “Move DB from beforeState → to newState safely”

    if (existing.rowCount > 0) {
      beforeState = existing.rows[0];
      action = "UPDATED";

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

      console.log("Subscription created:", subscriptionId);
    }

    // ✅ 4. Audit log (INSIDE transaction)
    await logSubscriptionAudit(client, {
      subscriptionId,
      actor: "stripe_webhook",
      action,
      reason: "invoice.payment_succeeded",
      before: beforeState,
      after: newState,
      metadata: {
        invoice_id: invoice.id,
        event_id: event.id
      }
    });

    // ✅ COMMIT (everything succeeded)
    await client.query("COMMIT");

    console.log("Transaction committed:", event.id);

  } catch (error) {
    // ❌ ROLLBACK (nothing saved)
    await client.query("ROLLBACK");

    console.error("Transaction rolled back:", event.id, error);

    throw error; // let Stripe retry
  }
}

module.exports = { handleInvoicePaymentSucceeded };
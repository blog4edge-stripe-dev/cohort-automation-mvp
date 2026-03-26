require("dotenv").config();
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const pool = require("./db");

const { handlePaymentSucceeded } = require("./services/paymentService");
const { createSubscription } = require("./services/subscriptionService");
const { handlePaymentIntentSucceeded } = require("./services/invoiceService");

const { log } = require("./utils/logger");

const app = express();

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // ✅ Idempotency
      const result = await client.query(
        `
        INSERT INTO processed_events (id, processed_at)
        VALUES ($1, NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        `,
        [event.id]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(200).json({ ignored: true });
      }

      // ✅ Event handling INSIDE SAME TRANSACTION
      switch (event.type) {

        case "invoice.payment_succeeded":
          await handleInvoicePaymentSucceeded(event, client);
          break;

        case "customer.subscription.created":
          await createSubscription(event, client);
          break;

        case "payment_intent.succeeded":
          await handlePaymentIntentSucceeded(event, client);
          break;

        default:
          console.log("Unhandled event:", event.type);
      }

      // ✅ Commit EVERYTHING together
      await client.query("COMMIT");

      return res.status(200).json({ received: true });

    } catch (err) {

      await client.query("ROLLBACK");

      console.error("Webhook error:", err);

      return res.status(200).json({ error: "handled" }); // prevent retries

    } finally {
      client.release();
    }
  }
);

// DB test
pool.query("SELECT NOW()")
  .then(res => {
    log("info", "Database connected", {
      serverTime: res.rows[0],
    });
  })
  .catch(err => {
    log("error", "Database connection failed", {
      error: err.message,
    });
  });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log("info", "Server started", { port: PORT });
});
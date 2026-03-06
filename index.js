require("dotenv").config();
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const pool = require("./db");
const { handlePaymentSucceeded } = require("./services/paymentService");
const { log } = require("./utils/logger");

const app = express();

/*
  IMPORTANT:
  Do NOT use express.json() before webhook.
  Stripe requires raw body for signature verification.
*/

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const startTime = Date.now();
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    // 1️⃣ Verify Stripe signature
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
    } catch (err) {
      log("error", "Stripe signature verification failed", {
        error: err.message,
      });

      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const eventId = event.id;
    const eventType = event.type;
    const eventCreated = event.created;

    const stripeObject = event.data.object;

    // 2️⃣ Log webhook metadata
    log("info", "Webhook verified", {
      eventId,
      eventType,
      eventCreated
    });

    // 3️⃣ Log Stripe object snapshot (VERY useful for debugging)
    log("info", "Stripe object snapshot", {
      eventId,
      eventType,
      objectType: stripeObject.object,
      objectId: stripeObject.id,
      status: stripeObject.status || null,
      customer: stripeObject.customer || null,
      subscription: stripeObject.subscription || null,
      invoice: stripeObject.invoice || null,
      amount:
        stripeObject.amount ||
        stripeObject.amount_paid ||
        stripeObject.amount_due ||
        null,
      currency: stripeObject.currency || null
    });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      log("info", "Transaction started", { eventId });

      // Insert into processed_events
      const result = await client.query(
        `
        INSERT INTO processed_events (id, processed_at)
        VALUES ($1, NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        `,
        [eventId]
      );

      // Duplicate event
      if (result.rowCount === 0) {
        await client.query("ROLLBACK");

        log("warn", "Duplicate event ignored", {
          eventId,
        });

        return res.status(200).json({ ignored: true });
      }

      log("info", "Event marked as processing", {
        eventId,
      });

      // 4️⃣ Run business logic
      switch (eventType) {

        case "payment_intent.succeeded":
          await handlePaymentSucceeded(event, client);
          break;

        case "invoice.payment_succeeded":
          log("info", "Invoice payment succeeded event received", {
            eventId,
            invoiceId: stripeObject.id,
            subscriptionId: stripeObject.subscription,
            customerId: stripeObject.customer
          });
          break;

        case "invoice.payment_failed":
          log("info", "Invoice payment failed event received", {
            eventId,
            invoiceId: stripeObject.id,
            subscriptionId: stripeObject.subscription
          });
          break;

        case "customer.subscription.created":
          log("info", "Subscription created", {
            eventId,
            subscriptionId: stripeObject.id,
            customerId: stripeObject.customer,
            status: stripeObject.status
          });
          break;

        case "customer.subscription.updated":
          log("info", "Subscription updated", {
            eventId,
            subscriptionId: stripeObject.id,
            status: stripeObject.status
          });
          break;

        case "customer.subscription.deleted":
          log("info", "Subscription deleted", {
            eventId,
            subscriptionId: stripeObject.id,
            status: stripeObject.status
          });
          break;

        default:
          log("info", "Unhandled event type skipped", {
            eventId,
            eventType,
          });
      }

      await client.query("COMMIT");

      const durationMs = Date.now() - startTime;

      log("info", "Transaction committed successfully", {
        eventId,
        durationMs,
      });

      return res.status(200).json({ received: true });

    } catch (err) {

      await client.query("ROLLBACK");

      const durationMs = Date.now() - startTime;

      log("error", "Transaction rolled back", {
        eventId,
        error: err.message,
        durationMs,
      });

      return res.status(500).send("Webhook processing failed");

    } finally {
      client.release();
    }
  }
);


// Optional: DB connection test on startup
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
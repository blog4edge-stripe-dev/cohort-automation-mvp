require("dotenv").config();
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const pool = require("./db");
const { handlePaymentSucceeded } = require("./services/paymentService");


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
      console.error("❌ Signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const eventId = event.id;
    const eventType = event.type;

    console.log("📩 Verified event:", eventId, eventType);

    // 2️⃣ Database idempotency (atomic)
    try {
      const result = await pool.query(
        `
        INSERT INTO processed_events (id, processed_at)
        VALUES ($1, NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        `,
        [eventId]
      );

      // If no row returned → duplicate
      if (result.rowCount === 0) {
        console.log("⚠️ Duplicate event ignored:", eventId);
        return res.status(200).json({ ignored: true });
      } 

    } catch (err) {
      console.error("❌ Database error:", err);
      return res.status(500).send("Database error");
    }

    // 3️⃣ Run business logic ONLY if event is new
    if (eventType === "payment_intent.succeeded") {
        try {
                await handlePaymentSucceeded(event);
        } 
        catch (err) {
            console.error("❌ Payment processing failed:", err);
            return res.status(500).send("Payment logic failed");
        }
    }

    // 4️⃣ Acknowledge Stripe AFTER everything succeeded 
    return res.status(200).json({ received: true });
  }
);


// Optional: DB connection test on startup
pool.query("SELECT NOW()")
  .then(res => {
    console.log("✅ DB Connected:", res.rows[0]);
  })
  .catch(err => {
    console.error("❌ DB Connection Error:", err);
  });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

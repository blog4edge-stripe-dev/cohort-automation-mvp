function log(level, message, data = {}) {
  const logEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data
  };

  console.log(JSON.stringify(logEntry));
}

async function logSubscriptionAudit(client, logData) {

  const {
    subscriptionId,
    actor = "system",
    action,
    reason,
    before = null,
    after = null,
    metadata = {}
  } = logData;

  const timestamp = new Date().toISOString();

  console.log("📜 AUDIT LOG:", {
    subscriptionId,
    action,
    reason
  });

  await client.query(
    `
    INSERT INTO subscription_audit_logs
    (
      subscription_id,
      actor,
      action,
      reason,
      before_state,
      after_state,
      metadata,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      subscriptionId,
      actor,
      action,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      JSON.stringify({
        ...metadata,
        timestamp
      }),
      timestamp
    ]
  );
}

module.exports = {
  log,
  logSubscriptionAudit
};
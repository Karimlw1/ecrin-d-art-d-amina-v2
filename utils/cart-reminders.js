
const escapeHtml = (value) => {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[char];
  });
};


// Build the reminder email.
function buildReminderEmail(cart, items, reminderType) {
  const name = escapeHtml(cart.full_name);
  const baseUrl = (
    process.env.APP_URL || "https://www.ecrinamina.com"
  ).replace(/\/+$/, "");

  const itemList = items.map((item) => {
    return `
      <li style="margin-bottom:10px;">
        <strong>${escapeHtml(item.name)}</strong><br>
        Taille : ${escapeHtml(item.size)}<br>
        Couleur : ${escapeHtml(item.color_name)}<br>
        Quantité : ${item.quantity}
      </li>
    `;
  }).join("");

  const isSecond = reminderType === "second";

  const heading = isSecond
    ? "Votre panier vous attend toujours"
    : "Vous avez oublié quelque chose ?";

  const message = isSecond
    ? "Votre sélection est toujours dans votre panier. N'hésitez pas à finaliser votre commande."
    : "Vous avez ajouté des articles à votre panier sans terminer votre commande.";

  return {
    subject: isSecond
      ? "Votre panier vous attend | Écrin d’Art d’Amina"
      : "N'oubliez pas votre panier | Écrin d’Art d’Amina",

    html: `
      <div style="
        max-width:600px;
        margin:auto;
        padding:30px;
        font-family:Arial,sans-serif;
        color:#292929;
        background:#ffffff;
      ">
        <h2 style="text-align:center;">
          Écrin d’Art d’Amina
        </h2>

        <hr style="border:0;border-top:1px solid #eee;">

        <h2>${heading}</h2>

        <p>Bonjour ${name},</p>

        <p>${message}</p>

        <h3>Votre sélection :</h3>

        <ul>${itemList}</ul>

        <div style="text-align:center;margin:30px 0;">
          <a
            href="${baseUrl}/cart"
            style="
              display:inline-block;
              padding:14px 25px;
              background:#222;
              color:#fff;
              text-decoration:none;
              border-radius:4px;
            "
          >
            Reprendre mon panier
          </a>
        </div>

        <p style="font-size:13px;color:#777;">
          Merci de votre visite chez Écrin d’Art d’Amina.
        </p>
      </div>
    `
  };
}


// Atomically claim a reminder so two app instances
// cannot normally send the same reminder simultaneously.
async function claimReminder(pool, cart, reminderType) {
  const [insert] = await pool.query(
    `INSERT IGNORE INTO cart_reminder_logs
      (cart_id, cart_last_activity, reminder_type, status, claimed_at)
     VALUES (?, ?, ?, 'sending', NOW())`,
    [cart.id, cart.last_activity, reminderType]
  );

  if (insert.affectedRows === 1) {
    return true;
  }

  // Retry a previous attempt if it was interrupted
  // or failed more than 30 minutes ago.
  const [retry] = await pool.query(
    `UPDATE cart_reminder_logs
     SET status = 'sending',
         claimed_at = NOW(),
         sent_at = NULL
     WHERE cart_id = ?
       AND cart_last_activity = ?
       AND reminder_type = ?
       AND status = 'sending'
       AND claimed_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
    [cart.id, cart.last_activity, reminderType]
  );

  return retry.affectedRows === 1;
}


// Send one reminder.
async function sendCartReminder(
  pool,
  sendEmail,
  cart,
  items,
  reminderType
) {
  const claimed = await claimReminder(
    pool,
    cart,
    reminderType
  );

  if (!claimed) {
    return;
  }

  try {
    const email = buildReminderEmail(
      cart,
      items,
      reminderType
    );

    await sendEmail(
      cart.email,
      email.subject,
      email.html
    );

    await pool.query(
      `UPDATE cart_reminder_logs
       SET status = 'sent',
           sent_at = NOW()
       WHERE cart_id = ?
         AND cart_last_activity = ?
         AND reminder_type = ?`,
      [cart.id, cart.last_activity, reminderType]
    );

    console.log(
      `Cart reminder ${reminderType} sent to ${cart.email}`
    );

  } catch (error) {
    // Make the failed attempt eligible for retry.
    await pool.query(
      `UPDATE cart_reminder_logs
       SET claimed_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE)
       WHERE cart_id = ?
         AND cart_last_activity = ?
         AND reminder_type = ?
         AND status = 'sending'`,
      [cart.id, cart.last_activity, reminderType]
    );

    throw error;
  }
}


// Check eligible carts.
async function checkAbandonedCarts(pool, sendEmail) {
  const [carts] = await pool.query(
    `SELECT
       c.id,
       c.last_activity,
       c.user_id,
       u.full_name,
       u.email,
       TIMESTAMPDIFF(
         MINUTE,
         c.last_activity,
         NOW()
       ) AS inactive_minutes
     FROM carts c
     INNER JOIN users u ON u.id = c.user_id
     WHERE c.status IN ('active', 'abandoned')
       AND u.role = 'customer'
       AND u.is_active = 1
       AND c.last_activity <= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND EXISTS (
         SELECT 1
         FROM cart_items ci
         WHERE ci.cart_id = c.id
           AND ci.quantity > 0
       )
     ORDER BY c.last_activity ASC
     LIMIT 250`
  );

  for (const cart of carts) {
    try {
      const [firstReminder] = await pool.query(
        `SELECT status
         FROM cart_reminder_logs
         WHERE cart_id = ?
           AND cart_last_activity = ?
           AND reminder_type = 'first'
         LIMIT 1`,
        [cart.id, cart.last_activity]
      );

      // First reminder has not been successfully sent.
      if (
        !firstReminder.length ||
        firstReminder[0].status !== "sent"
      ) {
        const [items] = await pool.query(
          `SELECT
             p.name,
             v.size,
             v.color_name,
             ci.quantity
           FROM cart_items ci
           INNER JOIN product_variants v
             ON v.id = ci.variant_id
           INNER JOIN products p
             ON p.id = v.product_id
           WHERE ci.cart_id = ?
             AND ci.quantity > 0`,
          [cart.id]
        );

        if (items.length > 0) {
          await sendCartReminder(
            pool,
            sendEmail,
            cart,
            items,
            "first"
          );
        }

        // Never send both reminders in the same run.
        continue;
      }

      // Second reminder: only after 24 hours,
      // and only if the first reminder was sent.
      if (Number(cart.inactive_minutes) >= 1440) {
        const [items] = await pool.query(
          `SELECT
             p.name,
             v.size,
             v.color_name,
             ci.quantity
           FROM cart_items ci
           INNER JOIN product_variants v
             ON v.id = ci.variant_id
           INNER JOIN products p
             ON p.id = v.product_id
           WHERE ci.cart_id = ?
             AND ci.quantity > 0`,
          [cart.id]
        );

        if (items.length > 0) {
          await sendCartReminder(
            pool,
            sendEmail,
            cart,
            items,
            "second"
          );
        }
      }

    } catch (error) {
      console.error(
        `Cart reminder error for cart ${cart.id}:`,
        error.message
      );
    }
  }
}


// Start the automatic checker.
function startCartReminderJob({ pool, sendEmail }) {
  let isRunning = false;

  const run = async () => {
    if (isRunning) return;

    isRunning = true;

    try {
      await checkAbandonedCarts(pool, sendEmail);
    } catch (error) {
      console.error("Cart reminder job error:", error);
    } finally {
      isRunning = false;
    }
  };

  // Check immediately, then every five minutes.
  run();

  const timer = setInterval(run, 5 * 60 * 1000);

  return timer;
}

module.exports = {
  startCartReminderJob
};

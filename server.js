
// server.js - Ecrin d'Art d'Amina
// Serveur principal : Express, MySQL, EJS, Cloudinary et gestion des commandes.

require("dotenv").config();

// =====================================================
// 1. DEPENDENCIES
// =====================================================

const express = require("express");
const path = require("path");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const flash = require("connect-flash");
const helmet = require("helmet");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");

const { sendEmail } = require("./utils/email");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// =====================================================
// 2. APPLICATION AND DATABASE
// =====================================================

const app = express();

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const PORT = Number(process.env.PORT || 3000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ashion_db",

  ssl: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true
  },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

// =====================================================
// 3. LABELS
// =====================================================

const LABELS = {
  pending: "En attente",
  confirmed: "Confirmée",
  processing: "En préparation",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",

  awaiting_confirmation: "En attente de confirmation",
  paid: "Payé",
  failed: "Échoué",
  refunded: "Remboursé",

  active: "Actif",
  draft: "Brouillon",
  archived: "Archivé",
  abandoned: "Abandonné",
  converted: "Converti",
  published: "Publié",
  hidden: "Masqué",

  airtel_money: "Airtel Money",
  orange_money: "Orange Money",
  cash_on_delivery: "Paiement à la livraison",

  page_view: "Page consultée",
  product_view: "Produit consulté",
  add_to_cart: "Ajout au panier",
  remove_from_cart: "Retrait du panier",
  checkout_started: "Commande démarrée",
  order_placed: "Commande passée",
  search: "Recherche"
};

app.locals.label = (value) =>
  LABELS[value] ||
  String(value == null ? "" : value).replaceAll("_", " ");

// =====================================================
// 4. EXPRESS MIDDLEWARE
// =====================================================

app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.urlencoded({
  extended: true,
  limit: "1mb"
}));

app.use(express.json({
  limit: "1mb"
}));

app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// 5. SESSION
// =====================================================

const sessionStore = new MySQLStore({}, pool);

app.use(session({
  key: "ashion.sid",
  secret: process.env.SESSION_SECRET || "change-this-development-secret",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  proxy: true,

  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(flash());

// =====================================================
// 6. LOCAL IMAGE UPLOAD
// Product images and profile pictures.
// =====================================================

const uploadDir = path.join(__dirname, "public", "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    cb(
      null,
      `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`
    );
  }
});

const allowedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
];

const imageFileFilter = (req, file, cb) => {
  if (!allowedImageTypes.includes(file.mimetype)) {
    return cb(
      new Error("Téléversez une image JPG, PNG, WEBP ou GIF.")
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter
});

// =====================================================
// 7. CLOUDINARY CONFIGURATION
// Payment screenshots only.
// IMPORTANT: This must be before paymentUpload and routes.
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const paymentStorage = new CloudinaryStorage({
  cloudinary,

  params: {
    folder: "ecrin-d-art-d-amina/payment_proofs",
    resource_type: "image",
    type: "authenticated",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"]
  }
});

const paymentUpload = multer({
  storage: paymentStorage,

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: imageFileFilter
});

// =====================================================
// 8. HELPER FUNCTIONS
// =====================================================

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash("error", "Veuillez vous connecter pour continuer.");
    return res.redirect("/login");
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    req.flash("error", "L'accès administrateur est requis.");
    return res.redirect("/login");
  }

  next();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180) || `item-${Date.now()}`;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function track(req, eventType, productId = null, metadata = {}) {
  const sessionKey = req.sessionID || null;
  const userId = req.session.user ? req.session.user.id : null;

  const ipHash = crypto
    .createHash("sha256")
    .update(String(req.ip || ""))
    .digest("hex");

  pool.query(
    `INSERT INTO client_activity
     (user_id, session_key, event_type, product_id, metadata, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      sessionKey,
      eventType,
      productId,
      JSON.stringify(metadata),
      ipHash
    ]
  ).catch(() => {});
}

// =====================================================
// 9. CART FUNCTIONS
// =====================================================

async function getCart(req) {
  const sessionKey = req.sessionID;
  const userId = req.session.user ? req.session.user.id : null;

  let [rows] = await pool.query(
    `SELECT * FROM carts
     WHERE session_key = ? AND status = 'active'
     ORDER BY id DESC LIMIT 1`,
    [sessionKey]
  );

  let cart = rows[0];

  if (!cart) {
    const [result] = await pool.query(
      `INSERT INTO carts (user_id, session_key, status)
       VALUES (?, ?, 'active')`,
      [userId, sessionKey]
    );

    cart = {
      id: result.insertId,
      user_id: userId,
      session_key: sessionKey,
      status: "active"
    };
  } else if (userId && cart.user_id !== userId) {
    await pool.query(
      "UPDATE carts SET user_id = ? WHERE id = ?",
      [userId, cart.id]
    );

    cart.user_id = userId;
  }

  return cart;
}

async function getCartDetails(req) {
  const cart = await getCart(req);

  const [items] = await pool.query(
    `SELECT
       ci.id AS cart_item_id,
       ci.quantity,
       v.id AS variant_id,
       v.size,
       v.color_name,
       v.color_hex,
       v.price,
       v.stock_quantity,
       p.id AS product_id,
       p.name,
       p.image_url,
       p.slug
     FROM cart_items ci
     JOIN product_variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE ci.cart_id = ? AND p.status = 'active'
     ORDER BY ci.added_at DESC`,
    [cart.id]
  );

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return { cart, items, subtotal };
}

// =====================================================
// 10. PRODUCT FUNCTION
// =====================================================

async function getProduct(productId) {
  const [products] = await pool.query(
    `SELECT
       p.*,
       c.name AS category_name,

       (SELECT MIN(v.price)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active = 1
       ) AS from_price,

       (SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active = 1
       ) AS stock_total,

       (SELECT ROUND(AVG(r.rating), 1)
        FROM reviews r
        WHERE r.product_id = p.id AND r.status = 'published'
       ) AS average_rating,

       (SELECT COUNT(*)
        FROM reviews r
        WHERE r.product_id = p.id AND r.status = 'published'
       ) AS review_count

     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.status = 'active'
     LIMIT 1`,
    [productId]
  );

  if (!products.length) return null;

  const product = products[0];

  const [variants] = await pool.query(
    `SELECT * FROM product_variants
     WHERE product_id = ? AND is_active = 1
     ORDER BY size, color_name`,
    [productId]
  );

  product.variants = variants;

  return product;
}

// =====================================================
// 11. GLOBAL VIEW MIDDLEWARE
// =====================================================

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cartCount = 0;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");

  try {
    const cart = await getCart(req);

    if (cart) {
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(quantity), 0) AS count
         FROM cart_items WHERE cart_id = ?`,
        [cart.id]
      );

      res.locals.cartCount = Number(row.count || 0);
    }
  } catch (err) {
    // La boutique reste utilisable même si le panier ne peut pas être chargé.
  }

  next();
});

// =====================================================
// 12. EMAIL TEST
// Remove this route before production.
// =====================================================

app.get("/test-email", async (req, res, next) => {
  try {
    await sendEmail(
      "YOUR_PERSONAL_EMAIL@gmail.com",
      "Ecrin d'art d'amina - Test d'e-mail",
      `
        <div style="font-family: Arial; padding: 25px;">
          <h2 style="color: #172554;">Ecrin d'art d'amina</h2>
          <p>Votre système d'e-mail fonctionne correctement !</p>
        </div>
      `
    );

    res.send("E-mail envoyé avec succès !");
  } catch (error) {
    next(error);
  }
});

// =====================================================
// 13. FORGOT PASSWORD
// =====================================================

app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", {
    title: "Mot de passe oublié"
  });
});

app.post("/forgot-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      req.flash("error", "Veuillez saisir votre adresse e-mail.");
      return res.redirect("/forgot-password");
    }

    const [users] = await pool.query(
      `SELECT id, email FROM users
       WHERE email = ? AND is_active = 1`,
      [email]
    );

    req.flash(
      "success",
      "Si cette adresse existe, vous recevrez un lien de réinitialisation."
    );

    if (!users.length) {
      return res.redirect("/forgot-password");
    }

    const token = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    await pool.query(
      "DELETE FROM password_resets WHERE email = ?",
      [email]
    );

    await pool.query(
      `INSERT INTO password_resets
       (email, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [email, tokenHash]
    );

    const resetLink =
      `${process.env.BASE_URL}/reset-password/${token}`;

    await sendEmail(
      email,
      "Réinitialisation de votre mot de passe - Ecrin d'art d'amina",
      `
        <div style="font-family: Arial; max-width: 550px; margin: auto; padding: 30px;">
          <h2 style="color: #172554;">Ecrin d'art d'amina</h2>
          <h3>Réinitialisation du mot de passe</h3>
          <p>Nous avons reçu une demande de réinitialisation de votre mot de passe.</p>
          <a href="${resetLink}"
             style="display:inline-block; padding:14px 25px;
             background:#172554; color:white;
             text-decoration:none; border-radius:5px;">
            Réinitialiser mon mot de passe
          </a>
          <p>Ce lien expire dans 30 minutes.</p>
          <p>Si vous n'avez pas demandé cette modification, ignorez cet e-mail.</p>
        </div>
      `
    );

    res.redirect("/forgot-password");
  } catch (error) {
    next(error);
  }
});

// =====================================================
// 14. RESET PASSWORD
// =====================================================

app.get("/reset-password/:token", async (req, res, next) => {
  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const [rows] = await pool.query(
      `SELECT email FROM password_resets
       WHERE token_hash = ? AND expires_at > NOW()`,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(400).render("error", {
        title: "Lien invalide",
        message: "Ce lien a expiré ou a déjà été utilisé."
      });
    }

    res.render("reset-password", {
      title: "Nouveau mot de passe",
      token: req.params.token
    });
  } catch (error) {
    next(error);
  }
});

app.post("/reset-password/:token", async (req, res, next) => {
  let connection;

  try {
    const { password, confirmPassword } = req.body;

    if (!password || password.length < 8) {
      req.flash("error", "Le mot de passe doit contenir au moins 8 caractères.");
      return res.redirect(`/reset-password/${req.params.token}`);
    }

    if (password !== confirmPassword) {
      req.flash("error", "Les mots de passe ne correspondent pas.");
      return res.redirect(`/reset-password/${req.params.token}`);
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT email FROM password_resets
       WHERE token_hash = ? AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (!rows.length) {
      await connection.rollback();

      req.flash("error", "Ce lien est invalide ou expiré.");
      return res.redirect("/forgot-password");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const email = rows[0].email;

    await connection.query(
      "UPDATE users SET password_hash = ? WHERE email = ?",
      [hashedPassword, email]
    );

    await connection.query(
      "DELETE FROM password_resets WHERE email = ?",
      [email]
    );

    await connection.commit();

    req.flash(
      "success",
      "Votre mot de passe a été modifié. Connectez-vous."
    );

    res.redirect("/login");
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

// =====================================================
// 15. HOME PAGE
// =====================================================

app.get("/", async (req, res, next) => {
  try {
    const [categories] = await pool.query(
      "SELECT * FROM categories ORDER BY id"
    );

    const [featured] = await pool.query(
      `SELECT
         p.*,
         c.name AS category_name,

         (SELECT MIN(v.price)
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active = 1
         ) AS from_price,

         (SELECT ROUND(AVG(r.rating), 1)
          FROM reviews r
          WHERE r.product_id = p.id AND r.status = 'published'
         ) AS average_rating

       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'active'
       ORDER BY RAND()
       LIMIT 8`
    );

    track(req, "page_view");

    res.render("home", {
      title: "Accueil",
      categories,
      currency: req.session.user?.currency || "CDF",
      products: featured
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 16. SHOP
// =====================================================

app.get("/shop", async (req, res, next) => {
  try {
    const {
      category,
      q,
      sort,
      type,
      size,
      color,
      min_price,
      max_price
    } = req.query;

    let sql = `
      SELECT p.*, c.name AS category_name,

        (SELECT MIN(v.price)
         FROM product_variants v
         WHERE v.product_id = p.id AND v.is_active = 1
        ) AS from_price,

        (SELECT ROUND(AVG(r.rating), 1)
         FROM reviews r
         WHERE r.product_id = p.id AND r.status = 'published'
        ) AS average_rating

      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'active'
    `;

    const params = [];

    if (category) {
      sql += " AND c.slug = ?";
      params.push(category);
    }

    if (type) {
      sql += " AND p.type = ?";
      params.push(type);
    }

    if (q && q.trim()) {
      sql += " AND (p.name LIKE ? OR p.description LIKE ?)";
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);

      track(req, "search", null, { q });
    }

    if (size || color || min_price !== undefined || max_price !== undefined) {
      const conditions = [
        "v.product_id = p.id",
        "v.is_active = 1"
      ];

      const variantParams = [];

      if (size) {
        conditions.push("v.size = ?");
        variantParams.push(size);
      }

      if (color) {
        conditions.push("v.color_name = ?");
        variantParams.push(color);
      }

      if (min_price !== undefined && min_price !== "") {
        const min = Number(min_price);

        if (Number.isFinite(min) && min >= 0) {
          conditions.push("v.price >= ?");
          variantParams.push(min);
        }
      }

      if (max_price !== undefined && max_price !== "") {
        const max = Number(max_price);

        if (Number.isFinite(max) && max >= 0) {
          conditions.push("v.price <= ?");
          variantParams.push(max);
        }
      }

      sql += `
        AND EXISTS (
          SELECT 1 FROM product_variants v
          WHERE ${conditions.join(" AND ")}
        )
      `;

      params.push(...variantParams);
    }

    const sortMap = {
      newest: "p.created_at DESC",
      price_asc: "from_price ASC",
      price_desc: "from_price DESC",
      name: "p.name ASC"
    };

    sql += ` ORDER BY ${sortMap[sort] || sortMap.newest}`;

    const [products] = await pool.query(sql, params);

    const [categories] = await pool.query(
      "SELECT * FROM categories ORDER BY name"
    );

    const [sizes] = await pool.query(
      `SELECT DISTINCT size FROM product_variants
       WHERE is_active = 1 ORDER BY size`
    );

    const [colors] = await pool.query(
      `SELECT DISTINCT color_name FROM product_variants
       WHERE is_active = 1 ORDER BY color_name`
    );

    res.render("shop", {
      title: "Boutique",
      products,
      categories,
      sizes,
      colors,
      selectedCategory: category || "",
      q: q || "",
      sort: sort || "newest",
      selectedSize: size || "",
      selectedColor: color || "",
      minPrice: min_price || "",
      maxPrice: max_price || "",
      currency: req.session.user?.currency || "CDF"
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 17. PRODUCT PAGE
// =====================================================

app.get("/product/:slug", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id FROM products
       WHERE slug = ? AND status = 'active'
       LIMIT 1`,
      [req.params.slug]
    );

    if (!rows.length) {
      return res.status(404).render("error", {
        title: "Introuvable",
        message: "Ce produit n'est pas disponible."
      });
    }

    const product = await getProduct(rows[0].id);

    const [reviews] = await pool.query(
      `SELECT r.*, u.full_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC`,
      [product.id]
    );

    track(req, "product_view", product.id);

    let currency = "CDF";

    if (req.session.user) {
      const [users] = await pool.query(
        "SELECT currency FROM users WHERE id = ?",
        [req.session.user.id]
      );

      if (users.length) {
        currency = users[0].currency || "CDF";
      }
    }

    res.render("product", {
      title: product.name,
      product,
      reviews,
      currency
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 18. REGISTER
// =====================================================

app.get("/register", (req, res) => {
  res.render("auth/register", {
    title: "Créer un compte"
  });
});

app.post("/register", async (req, res, next) => {
  try {
    const {
      full_name,
      email,
      phone,
      password,
      confirm_password
    } = req.body;

    if (!full_name || !email || !password) {
      req.flash("error", "Le nom, l'e-mail et le mot de passe sont obligatoires.");
      return res.redirect("/register");
    }

    if (password.length < 8) {
      req.flash("error", "Utilisez un mot de passe d'au moins 8 caractères.");
      return res.redirect("/register");
    }

    if (password !== confirm_password) {
      req.flash("error", "Les mots de passe ne correspondent pas.");
      return res.redirect("/register");
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users
       (full_name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, 'customer')`,
      [
        full_name.trim(),
        email.trim().toLowerCase(),
        phone || null,
        hash
      ]
    );

    req.flash("success", "Compte créé. Veuillez vous connecter.");
    res.redirect("/login");
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      req.flash("error", "Cette adresse e-mail possède déjà un compte.");
      return res.redirect("/register");
    }

    next(err);
  }
});

// =====================================================
// 19. LOGIN
// =====================================================

app.get("/login", (req, res) => {
  res.render("auth/login", {
    title: "Connexion"
  });
});

app.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const [rows] = await pool.query(
      `SELECT * FROM users
       WHERE email = ? AND is_active = 1
       LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      req.flash("error", "L'e-mail ou le mot de passe est incorrect.");
      return res.redirect("/login");
    }

    const passwordMatch = await bcrypt.compare(
      password,
      rows[0].password_hash
    );

    if (!passwordMatch) {
      req.flash("error", "L'e-mail ou le mot de passe est incorrect.");
      return res.redirect("/login");
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: rows[0].id,
        full_name: rows[0].full_name,
        email: rows[0].email,
        phone: rows[0].phone,
        role: rows[0].role,
        profile_image: rows[0].profile_image,
        theme: rows[0].theme,
        language: rows[0].language,
        currency: rows[0].currency
      };

      req.flash("success", `Bon retour, ${rows[0].full_name}.`);

      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);

        res.redirect(
          rows[0].role === "admin" ? "/admin" : "/account"
        );
      });
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 20. LOGOUT
// =====================================================

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// =====================================================
// 21. CUSTOMER ACCOUNT
// =====================================================

app.get("/account", requireLogin, async (req, res, next) => {
  try {
    const [orders] = await pool.query(
      `SELECT * FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.session.user.id]
    );

    res.render("account", {
      title: "Mon compte",
      orders
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 22. SETTINGS
// =====================================================

app.get("/settings", requireLogin, async (req, res, next) => {
  try {
    const [[account]] = await pool.query(
      `SELECT id, full_name, email, phone, profile_image,
              theme, language, currency
       FROM users WHERE id = ? LIMIT 1`,
      [req.session.user.id]
    );

    res.render("settings", {
      title: "Paramètres",
      account
    });
  } catch (err) {
    next(err);
  }
});

app.post(
  "/settings/profile",
  requireLogin,
  upload.single("profile_image"),
  async (req, res, next) => {
    try {
      const fullName = String(req.body.full_name || "").trim();
      const phone = String(req.body.phone || "").trim();

      const theme = ["light", "dark", "system"].includes(req.body.theme)
        ? req.body.theme
        : "system";

      const language = ["fr"].includes(req.body.language)
        ? req.body.language
        : "fr";

      const currency = ["CDF", "USD"].includes(req.body.currency)
        ? req.body.currency
        : "CDF";

      if (!fullName) {
        req.flash("error", "Le nom est obligatoire.");
        return res.redirect("/settings");
      }

      const [[currentUser]] = await pool.query(
        "SELECT profile_image FROM users WHERE id = ?",
        [req.session.user.id]
      );

      const profileImage = req.file
        ? `/uploads/${req.file.filename}`
        : currentUser.profile_image;

      await pool.query(
        `UPDATE users
         SET full_name = ?, phone = ?, profile_image = ?,
             theme = ?, language = ?, currency = ?
         WHERE id = ?`,
        [
          fullName,
          phone || null,
          profileImage,
          theme,
          language,
          currency,
          req.session.user.id
        ]
      );

      Object.assign(req.session.user, {
        full_name: fullName,
        phone,
        profile_image: profileImage,
        theme,
        language,
        currency
      });

      req.flash("success", "Vos paramètres ont été enregistrés.");
      res.redirect("/settings");
    } catch (err) {
      next(err);
    }
  }
);

app.post("/settings/security", requireLogin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");
    const confirmPassword = String(req.body.confirm_password || "");

    const [[account]] = await pool.query(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.session.user.id]
    );

    if (!await bcrypt.compare(currentPassword, account.password_hash)) {
      req.flash("error", "Le mot de passe actuel est incorrect.");
      return res.redirect("/settings#security");
    }

    if (newPassword.length < 8) {
      req.flash("error", "Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return res.redirect("/settings#security");
    }

    if (newPassword !== confirmPassword) {
      req.flash("error", "Les mots de passe ne correspondent pas.");
      return res.redirect("/settings#security");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [passwordHash, req.session.user.id]
    );

    req.flash("success", "Votre mot de passe a été modifié.");
    res.redirect("/settings#security");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 23. LEGAL PAGES
// =====================================================

app.get("/conditions-generales", (req, res) => {
  res.render("legal", {
    title: "Conditions générales",
    page: "terms"
  });
});

app.get("/cookies", (req, res) => {
  res.render("legal", {
    title: "Politique relative aux cookies",
    page: "cookies"
  });
});

// =====================================================
// 24. CART
// =====================================================

app.get("/cart", async (req, res, next) => {
  try {
    const cart = await getCartDetails(req);

    res.render("cart", {
      title: "Panier",
      ...cart
    });
  } catch (err) {
    next(err);
  }
});

app.post("/cart/add", async (req, res, next) => {
  try {
    const variantId = Number(req.body.variant_id);
    const quantity = Math.max(
      1,
      Math.min(20, Number(req.body.quantity || 1))
    );

    const [[variant]] = await pool.query(
      `SELECT v.*, p.id AS product_id
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = ? AND v.is_active = 1 AND p.status = 'active'`,
      [variantId]
    );

    if (!variant) {
      req.flash("error", "Choisissez une taille et une couleur valides.");
      return res.redirect(req.get("referer") || "/shop");
    }

    if (variant.stock_quantity < quantity) {
      req.flash("error", "Le stock est insuffisant pour cette quantité.");
      return res.redirect(req.get("referer") || "/shop");
    }

    const cart = await getCart(req);

    await pool.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
       quantity = LEAST(quantity + VALUES(quantity), ?)`,
      [cart.id, variantId, quantity, variant.stock_quantity]
    );

    track(req, "add_to_cart", variant.product_id, {
      variantId,
      quantity
    });

    req.flash("success", "Ajouté à votre panier.");
    res.redirect(req.get("referer") || "/cart");
  } catch (err) {
    next(err);
  }
});

app.post("/cart/update", async (req, res, next) => {
  try {
    const cart = await getCart(req);
    const itemId = Number(req.body.cart_item_id);
    const quantity = Number(req.body.quantity);

    if (quantity <= 0) {
      await pool.query(
        "DELETE FROM cart_items WHERE id = ? AND cart_id = ?",
        [itemId, cart.id]
      );

      track(req, "remove_from_cart");
    } else {
      await pool.query(
        `UPDATE cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         SET ci.quantity = LEAST(?, v.stock_quantity)
         WHERE ci.id = ? AND ci.cart_id = ?`,
        [Math.min(20, quantity), itemId, cart.id]
      );
    }

    res.redirect("/cart");
  } catch (err) {
    next(err);
  }
});

app.post("/cart/remove", async (req, res, next) => {
  try {
    const cart = await getCart(req);

    await pool.query(
      "DELETE FROM cart_items WHERE id = ? AND cart_id = ?",
      [Number(req.body.cart_item_id), cart.id]
    );

    track(req, "remove_from_cart");
    res.redirect("/cart");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 25. CHECKOUT PAGE
// =====================================================

app.get("/checkout", async (req, res, next) => {
  try {
    const cart = await getCartDetails(req);

    if (!cart.items.length) {
      req.flash("error", "Votre panier est vide.");
      return res.redirect("/shop");
    }

    track(req, "checkout_started");

    res.render("checkout", {
      title: "Commande",
      ...cart
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 26. CHECKOUT SUBMISSION
// paymentUpload is initialized above this route.
// =====================================================

app.post(
  "/checkout",
  paymentUpload.single("payment_proof"),
  async (req, res, next) => {
    let conn;
    let transactionStarted = false;

    try {
      conn = await pool.getConnection();

      const {
        customer_name,
        customer_email,
        customer_phone,
        shipping_country,
        shipping_city,
        shipping_address,
        payment_method,
        customer_note,
        payer_phone,
        provider_reference
      } = req.body;

      const allowed = [
        "airtel_money",
        "orange_money",
        "cash_on_delivery"
      ];

      if (
        !customer_name ||
        !customer_phone ||
        !shipping_city ||
        !shipping_address ||
        !allowed.includes(payment_method)
      ) {
        req.flash(
          "error",
          "Veuillez remplir tous les champs obligatoires de la commande."
        );

        return res.redirect("/checkout");
      }

      const isMobileMoney = [
        "airtel_money",
        "orange_money"
      ].includes(payment_method);

      let cleanPhone = null;

      if (isMobileMoney) {
        cleanPhone = String(payer_phone || "").replace(/\s/g, "");

        if (!/^\+243\d{9}$/.test(cleanPhone)) {
          req.flash(
            "error",
            "Veuillez saisir un numéro valide au format +2439XXXXXXXX."
          );

          return res.redirect("/checkout");
        }

        if (!provider_reference || !req.file) {
          req.flash(
            "error",
            "Veuillez fournir la référence et la capture du paiement."
          );

          return res.redirect("/checkout");
        }
      }

      const cart = await getCartDetails(req);

      if (!cart.items.length) {
        req.flash("error", "Votre panier est vide.");
        return res.redirect("/shop");
      }

      await conn.beginTransaction();
      transactionStarted = true;

      // Vérification du stock.
      for (const item of cart.items) {
        const [stockRows] = await conn.query(
          `SELECT stock_quantity
           FROM product_variants
           WHERE id = ?
           FOR UPDATE`,
          [item.variant_id]
        );

        if (
          !stockRows.length ||
          stockRows[0].stock_quantity < item.quantity
        ) {
          throw new Error(
            `Stock insuffisant pour ${item.name}. Veuillez mettre à jour votre panier.`
          );
        }
      }

      const subtotal = cart.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      const deliveryFee = 0;
      const total = subtotal + deliveryFee;

      const orderNumber =
        `ASH-${Date.now().toString(36).toUpperCase()}-` +
        crypto.randomBytes(2).toString("hex").toUpperCase();

      const userId = req.session.user
        ? req.session.user.id
        : null;

      const paymentStatus = isMobileMoney
        ? "awaiting_confirmation"
        : "pending";

      // Création de la commande.
      const [orderResult] = await conn.query(
        `INSERT INTO orders (
          order_number,
          user_id,
          customer_name,
          customer_email,
          customer_phone,
          shipping_country,
          shipping_city,
          shipping_address,
          currency,
          subtotal,
          delivery_fee,
          total,
          payment_method,
          payment_status,
          order_status,
          customer_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          orderNumber,
          userId,
          customer_name.trim(),
          customer_email || null,
          customer_phone.trim(),
          shipping_country || "RD Congo",
          shipping_city.trim(),
          shipping_address.trim(),
          subtotal,
          deliveryFee,
          total,
          payment_method,
          paymentStatus,
          customer_note || null
        ]
      );

      // Enregistrement des articles et diminution du stock.
      for (const item of cart.items) {
        await conn.query(
          `INSERT INTO order_items (
            order_id,
            variant_id,
            product_name,
            size,
            color_name,
            color_hex,
            unit_price,
            quantity,
            line_total
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderResult.insertId,
            item.variant_id,
            item.name,
            item.size,
            item.color_name,
            item.color_hex,
            item.price,
            item.quantity,
            item.price * item.quantity
          ]
        );

        await conn.query(
          `UPDATE product_variants
           SET stock_quantity = stock_quantity - ?
           WHERE id = ?`,
          [item.quantity, item.variant_id]
        );
      }

      // CloudinaryStorage fournit l'identifiant du fichier dans filename.
      const proofPath = isMobileMoney
        ? req.file.filename
        : null;

      // Enregistrement du paiement.
      await conn.query(
        `INSERT INTO payments (
          order_id,
          provider,
          amount,
          currency,
          status,
          provider_reference,
          payer_phone,
          proof_path
        )
        VALUES (?, ?, ?, 'USD', ?, ?, ?, ?)`,
        [
          orderResult.insertId,
          payment_method,
          total,
          paymentStatus,
          isMobileMoney ? provider_reference.trim() : null,
          cleanPhone,
          proofPath
        ]
      );

      // Historique de commande.
      await conn.query(
        `INSERT INTO order_status_history (
          order_id,
          old_status,
          new_status,
          changed_by,
          note
        )
        VALUES (?, NULL, 'pending', ?, 'Commande passée')`,
        [orderResult.insertId, userId]
      );

      // Conversion du panier.
      await conn.query(
        "UPDATE carts SET status = 'converted' WHERE id = ?",
        [cart.cart.id]
      );

      await conn.commit();
      transactionStarted = false;

      track(req, "order_placed", null, { orderNumber });

      res.render("order-success", {
        title: "Commande reçue",
        orderNumber,
        paymentMethod: payment_method
      });

    } catch (err) {
      if (conn && transactionStarted) {
        await conn.rollback();
      }

      console.error("Erreur checkout :", err);

      if (!res.headersSent) {
        req.flash(
          "error",
          err.message || "Impossible de passer votre commande."
        );

        res.redirect("/checkout");
      }
    } finally {
      if (conn) conn.release();
    }
  }
);

// =====================================================
// 27. PRODUCT REVIEWS
// =====================================================

app.post("/product/:id/review", requireLogin, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "")
      .trim()
      .slice(0, 2000);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      req.flash("error", "Choisissez une note de 1 à 5.");
      return res.redirect(req.get("referer") || "/shop");
    }

    await pool.query(
      `INSERT INTO reviews
       (user_id, product_id, rating, comment, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
       rating = VALUES(rating),
       comment = VALUES(comment),
       status = 'pending',
       created_at = CURRENT_TIMESTAMP`,
      [
        req.session.user.id,
        productId,
        rating,
        comment || null
      ]
    );

    req.flash(
      "success",
      "Merci ! Votre avis apparaîtra après modération."
    );

    res.redirect(req.get("referer") || "/shop");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 28. ADMIN DASHBOARD
// =====================================================

app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
        (SELECT COUNT(*) FROM products WHERE status <> 'archived') AS products,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COALESCE(SUM(total), 0)
         FROM orders WHERE payment_status = 'paid') AS revenue,
        (SELECT COUNT(*) FROM orders
         WHERE order_status IN ('pending', 'confirmed', 'processing')) AS open_orders,
        (SELECT COUNT(*) FROM carts
         WHERE status = 'active'
         AND last_activity >= NOW() - INTERVAL 30 DAY) AS active_carts`
    );

    const [recentOrders] = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 8"
    );

    const [recentActivity] = await pool.query(
      `SELECT a.*, u.full_name, p.name AS product_name
       FROM client_activity a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN products p ON p.id = a.product_id
       ORDER BY a.created_at DESC LIMIT 12`
    );

    res.render("admin/dashboard", {
      title: "Tableau de bord",
      stats,
      recentOrders,
      recentActivity
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 29. ADMIN PRODUCTS
// =====================================================

app.get("/admin/products", requireAdmin, async (req, res, next) => {
  try {
    const [products] = await pool.query(
      `SELECT p.*, c.name AS category_name,

       (SELECT MIN(price)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active = 1
       ) AS from_price,

       (SELECT COALESCE(SUM(stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active = 1
       ) AS stock_total

       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.created_at DESC`
    );

    res.render("admin/products", {
      title: "Gestion des produits",
      products
    });
  } catch (err) {
    next(err);
  }
});

app.get("/admin/products/new", requireAdmin, async (req, res, next) => {
  try {
    const [categories] = await pool.query(
      "SELECT * FROM categories ORDER BY name"
    );

    res.render("admin/product-form", {
      title: "Ajouter un produit",
      categories,
      product: null,
      variants: []
    });
  } catch (err) {
    next(err);
  }
});

app.post(
  "/admin/products",
  requireAdmin,
  upload.single("image"),
  async (req, res, next) => {
    try {
      const {
        name,
        category_id,
        description,
        status,
        featured,
        variants_json
      } = req.body;

      if (!name || !variants_json) {
        req.flash(
          "error",
          "Le nom du produit et au moins une variante taille/couleur sont obligatoires."
        );

        return res.redirect("/admin/products/new");
      }

      const variants = JSON.parse(variants_json);

      if (!Array.isArray(variants) || !variants.length) {
        throw new Error("Ajoutez au moins une variante.");
      }

      const slug = `${slugify(name)}-${crypto.randomBytes(2).toString("hex")}`;
      const imageUrl = req.file
        ? `/uploads/${req.file.filename}`
        : null;

      const [result] = await pool.query(
        `INSERT INTO products
         (category_id, name, slug, description, image_url, status, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          category_id || null,
          name.trim(),
          slug,
          description || null,
          imageUrl,
          ["active", "draft", "archived"].includes(status)
            ? status
            : "active",
          featured ? 1 : 0
        ]
      );

      for (const v of variants) {
        const price = Number(v.price);
        const stock = Math.max(
          0,
          Math.floor(Number(v.stock_quantity || 0))
        );

        if (
          !v.size ||
          !v.color_name ||
          !/^#[0-9a-fA-F]{6}$/.test(v.color_hex) ||
          !Number.isFinite(price) ||
          price < 0
        ) {
          throw new Error(
            "Vérifiez la taille, la couleur, le code couleur et le prix de chaque variante."
          );
        }

        await pool.query(
          `INSERT INTO product_variants
           (product_id, size, color_name, color_hex, price, stock_quantity, sku)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            result.insertId,
            v.size,
            v.color_name,
            v.color_hex,
            price,
            stock,
            v.sku || null
          ]
        );
      }

      req.flash("success", "Produit créé.");
      res.redirect("/admin/products");
    } catch (err) {
      next(err);
    }
  }
);

app.get("/admin/products/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const [[product]] = await pool.query(
      "SELECT * FROM products WHERE id = ?",
      [Number(req.params.id)]
    );

    if (!product) return res.redirect("/admin/products");

    const [categories] = await pool.query(
      "SELECT * FROM categories ORDER BY name"
    );

    const [variants] = await pool.query(
      "SELECT * FROM product_variants WHERE product_id = ? ORDER BY id",
      [product.id]
    );

    res.render("admin/product-form", {
      title: "Modifier le produit",
      categories,
      product,
      variants
    });
  } catch (err) {
    next(err);
  }
});

app.post(
  "/admin/products/:id",
  requireAdmin,
  upload.single("image"),
  async (req, res, next) => {
    try {
      const productId = Number(req.params.id);

      const {
        name,
        category_id,
        description,
        status,
        featured,
        variants_json
      } = req.body;

      const variants = JSON.parse(variants_json || "[]");

      if (!name || !variants.length) {
        throw new Error(
          "Le nom du produit et au moins une variante sont obligatoires."
        );
      }

      const [oldRows] = await pool.query(
        "SELECT image_url FROM products WHERE id = ?",
        [productId]
      );

      if (!oldRows.length) {
        return res.redirect("/admin/products");
      }

      const imageUrl = req.file
        ? `/uploads/${req.file.filename}`
        : oldRows[0].image_url;

      await pool.query(
        `UPDATE products
         SET category_id = ?, name = ?, description = ?,
             image_url = ?, status = ?, featured = ?
         WHERE id = ?`,
        [
          category_id || null,
          name.trim(),
          description || null,
          imageUrl,
          ["active", "draft", "archived"].includes(status)
            ? status
            : "active",
          featured ? 1 : 0,
          productId
        ]
      );

      const incomingIds = [];

      for (const v of variants) {
        const price = Number(v.price);
        const stock = Math.max(
          0,
          Math.floor(Number(v.stock_quantity || 0))
        );

        if (
          !v.size ||
          !v.color_name ||
          !/^#[0-9a-fA-F]{6}$/.test(v.color_hex) ||
          !Number.isFinite(price) ||
          price < 0
        ) {
          throw new Error(
            "Vérifiez la taille, la couleur, le code couleur et le prix de chaque variante."
          );
        }

        if (v.id) {
          await pool.query(
            `UPDATE product_variants
             SET size = ?, color_name = ?, color_hex = ?,
                 price = ?, stock_quantity = ?, sku = ?, is_active = 1
             WHERE id = ? AND product_id = ?`,
            [
              v.size,
              v.color_name,
              v.color_hex,
              price,
              stock,
              v.sku || null,
              v.id,
              productId
            ]
          );

          incomingIds.push(Number(v.id));
        } else {
          const [insert] = await pool.query(
            `INSERT INTO product_variants
             (product_id, size, color_name, color_hex, price, stock_quantity, sku)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              productId,
              v.size,
              v.color_name,
              v.color_hex,
              price,
              stock,
              v.sku || null
            ]
          );

          incomingIds.push(insert.insertId);
        }
      }

      if (incomingIds.length) {
        await pool.query(
          `UPDATE product_variants
           SET is_active = 0
           WHERE product_id = ?
           AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
          [productId, ...incomingIds]
        );
      }

      req.flash("success", "Produit mis à jour.");
      res.redirect("/admin/products");
    } catch (err) {
      next(err);
    }
  }
);

app.post("/admin/products/:id/archive", requireAdmin, async (req, res, next) => {
  try {
    await pool.query(
      "UPDATE products SET status = 'archived' WHERE id = ?",
      [Number(req.params.id)]
    );

    req.flash("success", "Produit archivé.");
    res.redirect("/admin/products");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 30. ADMIN ORDERS
// =====================================================

app.get("/admin/orders", requireAdmin, async (req, res, next) => {
  try {
    const [orders] = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 250"
    );

    res.render("admin/orders", {
      title: "Suivi des commandes",
      orders
    });
  } catch (err) {
    next(err);
  }
});

app.post("/admin/orders/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);

    const allowed = [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "cancelled"
    ];

    const status = req.body.order_status;

    if (!allowed.includes(status)) {
      throw new Error("Statut de commande invalide.");
    }

    const [[order]] = await pool.query(
      "SELECT order_status FROM orders WHERE id = ?",
      [orderId]
    );

    if (!order) return res.redirect("/admin/orders");

    await pool.query(
      "UPDATE orders SET order_status = ? WHERE id = ?",
      [status, orderId]
    );

    await pool.query(
      `INSERT INTO order_status_history
       (order_id, old_status, new_status, changed_by, note)
       VALUES (?, ?, ?, ?, ?)`,
      [
        orderId,
        order.order_status,
        status,
        req.session.user.id,
        req.body.note || null
      ]
    );

    req.flash("success", "Statut de la commande mis à jour.");
    res.redirect("/admin/orders");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 31. ADMIN PAYMENTS
// =====================================================


app.get("/admin/payments", requireAdmin, async (req, res, next) => {
  try {
    const [payments] = await pool.query(
      `SELECT
         pay.*,
         o.order_number,
         o.customer_name,
         o.customer_phone,
         o.payment_method
       FROM payments pay
       JOIN orders o ON o.id = pay.order_id
       ORDER BY pay.created_at DESC
       LIMIT 250`
    );

    // Générer les liens des captures Cloudinary.
    for (const payment of payments) {
      if (payment.proof_path) {
        payment.proof_url = cloudinary.url(payment.proof_path, {
          secure: true,
          sign_url: true,
          type: "authenticated",
          resource_type: "image"
        });
      }
    }

    res.render("admin/payments", {
      title: "Suivi des paiements",
      payments
    });

  } catch (err) {
    next(err);
  }
});


app.post("/admin/payments/:id/status", requireAdmin, async (req, res, next) => {
  let conn;

  try {
    const paymentId = Number(req.params.id);

    const allowed = [
      "pending",
      "paid",
      "failed",
      "refunded",
      "awaiting_confirmation"
    ];

    const status = req.body.status;

    if (!allowed.includes(status)) {
      throw new Error("Statut de paiement invalide.");
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[payment]] = await conn.query(
      "SELECT * FROM payments WHERE id = ? FOR UPDATE",
      [paymentId]
    );

    if (!payment) {
      await conn.rollback();
      return res.redirect("/admin/payments");
    }

    await conn.query(
      `UPDATE payments
       SET status = ?,
           provider_reference = ?,
           admin_note = ?,
           confirmed_by = ?,
           confirmed_at = IF(? = 'paid', NOW(), confirmed_at)
       WHERE id = ?`,
      [
        status,
        req.body.provider_reference || null,
        req.body.admin_note || null,
        req.session.user.id,
        status,
        paymentId
      ]
    );

    await conn.query(
      "UPDATE orders SET payment_status = ? WHERE id = ?",
      [status, payment.order_id]
    );

    await conn.commit();

    req.flash(
      "success",
      "Suivi du paiement mis à jour. Vérifiez l'argent reçu avant de le marquer comme payé."
    );

    res.redirect("/admin/payments");
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// =====================================================
// 32. ADMIN CUSTOMERS
// =====================================================

app.get("/admin/customers", requireAdmin, async (req, res, next) => {
  try {
    const [customers] = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.phone,
         u.is_active,
         u.created_at,
         COUNT(DISTINCT o.id) AS order_count,
         COALESCE(
           SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END),
           0
         ) AS paid_total
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.role = 'customer'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    res.render("admin/customers", {
      title: "Suivi des clients",
      customers
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 33. ADMIN CARTS
// =====================================================

app.get("/admin/carts", requireAdmin, async (req, res, next) => {
  try {
    const [carts] = await pool.query(
      `SELECT
         c.*,
         COALESCE(u.full_name, 'Visiteur invité') AS full_name,
         COALESCE(u.email, 'Invité') AS email,
         COUNT(ci.id) AS item_count,
         COALESCE(SUM(ci.quantity * v.price), 0) AS cart_value,

         GROUP_CONCAT(
           CONCAT(
             p.name, ' (',
             v.size, ' / ',
             v.color_name, ') × ',
             ci.quantity
           )
           SEPARATOR ' | '
         ) AS items

       FROM carts c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN cart_items ci ON ci.cart_id = c.id
       LEFT JOIN product_variants v ON v.id = ci.variant_id
       LEFT JOIN products p ON p.id = v.product_id

       WHERE c.status IN ('active', 'abandoned')
       GROUP BY c.id
       HAVING COUNT(ci.id) > 0
       ORDER BY c.last_activity DESC
       LIMIT 250`
    );

    res.render("admin/carts", {
      title: "Suivi des paniers",
      carts
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 34. ADMIN REVIEWS
// =====================================================

app.get("/admin/reviews", requireAdmin, async (req, res, next) => {
  try {
    const [reviews] = await pool.query(
      `SELECT r.*, u.full_name, p.name AS product_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
       ORDER BY FIELD(r.status, 'pending', 'published', 'hidden'),
                r.created_at DESC`
    );

    res.render("admin/reviews", {
      title: "Modération des avis",
      reviews
    });
  } catch (err) {
    next(err);
  }
});

app.post("/admin/reviews/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const status = [
      "pending",
      "published",
      "hidden"
    ].includes(req.body.status)
      ? req.body.status
      : "pending";

    await pool.query(
      "UPDATE reviews SET status = ? WHERE id = ?",
      [status, Number(req.params.id)]
    );

    req.flash("success", "Statut de l'avis mis à jour.");
    res.redirect("/admin/reviews");
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 35. ADMIN ACTIVITY
// =====================================================

app.get("/admin/activity", requireAdmin, async (req, res, next) => {
  try {
    const [activity] = await pool.query(
      `SELECT a.*, u.full_name, p.name AS product_name
       FROM client_activity a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN products p ON p.id = a.product_id
       ORDER BY a.created_at DESC
       LIMIT 500`
    );

    res.render("admin/activity", {
      title: "Activité des clients",
      activity
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 36. ORDER TRACKING
// =====================================================

app.get("/order/:orderNumber", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM orders
       WHERE order_number = ?
       LIMIT 1`,
      [req.params.orderNumber]
    );

    if (!rows.length) {
      return res.status(404).render("error", {
        title: "Commande introuvable",
        message: "Nous n'avons pas trouvé cette commande."
      });
    }

    const order = rows[0];

    if (
      order.user_id &&
      (
        !req.session.user ||
        (
          req.session.user.id !== order.user_id &&
          req.session.user.role !== "admin"
        )
      )
    ) {
      return res.status(403).render("error", {
        title: "Accès refusé",
        message: "Connectez-vous pour voir cette commande."
      });
    }

    const [items] = await pool.query(
      "SELECT * FROM order_items WHERE order_id = ?",
      [order.id]
    );

    const [history] = await pool.query(
      `SELECT * FROM order_status_history
       WHERE order_id = ?
       ORDER BY created_at`,
      [order.id]
    );

    res.render("order-track", {
      title: "Suivi de la commande",
      order,
      items,
      history
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// 37. FRENCH CATEGORY ROUTES
// =====================================================

app.get("/women", (req, res) => res.redirect("/femme"));
app.get("/men", (req, res) => res.redirect("/homme"));
app.get("/kids", (req, res) => res.redirect("/enfants"));
app.get("/accessories", (req, res) => res.redirect("/accessoires"));

app.get("/femme", (req, res) => {
  res.redirect("/shop?category=femme");
});

app.get("/homme", (req, res) => {
  res.redirect("/shop?category=homme");
});

app.get("/enfants", (req, res) => {
  res.redirect("/shop?category=enfant");
});

app.get("/accessoires", (req, res) => {
  res.redirect("/shop?type=accessoire");
});

// =====================================================
// 38. 404 HANDLER
// Keep this AFTER all routes.
// =====================================================

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Page introuvable",
    message: "Nous n'avons pas trouvé cette page."
  });
});

// =====================================================
// 39. GLOBAL ERROR HANDLER
// Keep this AFTER the 404 handler.
// =====================================================

app.use((err, req, res, next) => {
  console.error("Erreur serveur :", err);

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    req.flash(
      "error",
      err.code === "LIMIT_FILE_SIZE"
        ? "L'image ne doit pas dépasser 5 Mo."
        : "Échec du téléversement de l'image."
    );

    return res.redirect(req.get("referer") || "/");
  }

  if (
    err.message &&
    err.message.includes("Téléversez une image")
  ) {
    req.flash("error", err.message);
    return res.redirect(req.get("referer") || "/");
  }

  res.status(500).render("error", {
    title: "Une erreur est survenue",
    message: process.env.NODE_ENV === "production"
      ? "Veuillez réessayer plus tard."
      : (err.message || "Erreur inattendue du serveur.")
  });
});

// =====================================================
// 40. ADMIN BOOTSTRAP
// =====================================================

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (
    !email ||
    !password ||
    password === "ChangeThisAdminPassword123!"
  ) {
    console.warn(
      "Création de l'administrateur ignorée. Définissez ADMIN_EMAIL et un ADMIN_PASSWORD robuste."
    );

    return;
  }

  const [existing] = await pool.query(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email.toLowerCase()]
  );

  if (!existing.length) {
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users
       (full_name, email, password_hash, role)
       VALUES (?, ?, ?, 'admin')`,
      [
        process.env.ADMIN_NAME || "Administrateur",
        email.toLowerCase(),
        hash
      ]
    );

    console.log(`Compte administrateur créé pour ${email}`);
  }
}

// =====================================================
// 41. START SERVER
// =====================================================

(async () => {
  try {
    await pool.query("SELECT 1");

    console.log("TiDB database connected successfully!");

    await bootstrapAdmin();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Ecrin d'art d'amina fonctionne sur le port ${PORT}`
      );
    });
  } catch (err) {
    console.error("Erreur au démarrage :", err.message);
    process.exit(1);
  }
})();

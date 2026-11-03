// server.js - serveur principal de la boutique Ecrin d'art d'amina (Express + MySQL + EJS).
// Ce fichier contient toutes les routes : boutique, compte client, panier, commande et administration.

require("dotenv").config();

// Dépendances : serveur web, sessions, MySQL, sécurité, mots de passe, envoi de fichiers, e-mails.
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

// Création de l'application Express et choix du port d'écoute (3000 par défaut).
const app = express();
const PORT = Number(process.env.PORT || 3000);

// Libellés français des valeurs enregistrées en base (statuts, moyens de paiement, événements).
// Les valeurs en base restent en anglais ; seule leur AFFICHAGE est traduit, via label() dans les vues.
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
  card: "Carte bancaire",
  cash_on_delivery: "Paiement à la livraison",
  page_view: "Page consultée",
  product_view: "Produit consulté",
  add_to_cart: "Ajout au panier",
  remove_from_cart: "Retrait du panier",
  checkout_started: "Commande démarrée",
  order_placed: "Commande passée",
  search: "Recherche"
};
app.locals.label = (value) => LABELS[value] || String(value == null ? "" : value).replaceAll("_", " ");

// Pool de connexions MySQL ; les paramètres sont lus dans le fichier .env.
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ashion_db',

   ssl: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true
},

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true
});

// Les sessions sont stockées dans la base MySQL ; moteur de vues : EJS (dossier views).
const sessionStore = new MySQLStore({}, pool);
pool.getConnection()
    .then(connection => {
        console.log("TiDB database connected successfully!");
        connection.release();
    })
    .catch(error => {
        console.error("Database connection failed:", error.message);
    });
    
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
// Sécurité HTTP de base (helmet), lecture des formulaires et du JSON (1 Mo maximum).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
// Fichiers publics : CSS, JavaScript, images et photos téléversées.
app.use(express.static(path.join(__dirname, "public")));
// Configuration de la session : cookie httpOnly, durée de 7 jours, « secure » en production.
app.use(session({
  key: "ashion.sid",
  secret: process.env.SESSION_SECRET || "change-this-development-secret",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
// Messages flash (succès / erreur) affichés une seule fois.
app.use(flash());

// Middleware global : donne aux vues l'utilisateur connecté, le nombre d'articles du panier et les messages flash.
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cartCount = 0;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  try {
    const cart = await getCart(req);
    if (cart) {
      const [[row]] = await pool.query(
        "SELECT COALESCE(SUM(quantity),0) AS count FROM cart_items WHERE cart_id=?",
        [cart.id]
      );
      res.locals.cartCount = Number(row.count || 0);
    }
  } catch (err) {
    // La boutique reste utilisable même si la lecture du panier échoue.
  }
  next();
});

// Téléversement d'images : dossier public/uploads, noms de fichiers uniques.
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  }
});
// Limites : 5 Mo maximum et uniquement les formats JPG, PNG, WEBP ou GIF.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(new Error("Téléversez une image JPG, PNG, WEBP ou GIF."));
    }
    cb(null, true);
  }
});

// Protège une route : redirige vers la connexion si personne n'est connecté.
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash("error", "Veuillez vous connecter pour continuer.");
    return res.redirect("/login");
  }
  next();
}
// Protège une route : réservée au rôle « admin ».
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    req.flash("error", "L'accès administrateur est requis.");
    return res.redirect("/login");
  }
  next();
}
// Transforme un nom en identifiant d'URL (ex. « Robe rouge » devient « robe-rouge »).
function slugify(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180) || `item-${Date.now()}`;
}
// Formate un montant avec 2 décimales.
function money(value) {
  return Number(value || 0).toFixed(2);
}
// Enregistre une activité client (page vue, ajout au panier...) ; l'adresse IP n'est conservée que sous forme d'empreinte.
function track(req, eventType, productId = null, metadata = {}) {
  const sessionKey = req.sessionID || null;
  const userId = req.session.user ? req.session.user.id : null;
  const ipHash = crypto.createHash("sha256").update(String(req.ip || "")).digest("hex");
  pool.query(
    "INSERT INTO client_activity (user_id,session_key,event_type,product_id,metadata,ip_hash) VALUES (?,?,?,?,?,?)",
    [userId, sessionKey, eventType, productId, JSON.stringify(metadata), ipHash]
  ).catch(() => {});
}
// Retourne le panier actif de la session (le crée au besoin) et le rattache à l'utilisateur connecté.
async function getCart(req) {
  const sessionKey = req.sessionID;
  const userId = req.session.user ? req.session.user.id : null;
  let [rows] = await pool.query(
    "SELECT * FROM carts WHERE session_key=? AND status='active' ORDER BY id DESC LIMIT 1",
    [sessionKey]
  );
  let cart = rows[0];
  if (!cart) {
    const [result] = await pool.query(
      "INSERT INTO carts (user_id,session_key,status) VALUES (?,?, 'active')",
      [userId, sessionKey]
    );
    cart = { id: result.insertId, user_id: userId, session_key: sessionKey, status: "active" };
  } else if (userId && cart.user_id !== userId) {
    await pool.query("UPDATE carts SET user_id=? WHERE id=?", [userId, cart.id]);
    cart.user_id = userId;
  }
  return cart;
}
// Charge un produit actif avec prix minimum, stock total, note moyenne, nombre d'avis et variantes.
async function getProduct(productId) {
  const [products] = await pool.query(
    `SELECT p.*, c.name AS category_name,
      (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=1) AS from_price,
      (SELECT COALESCE(SUM(v.stock_quantity),0) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=1) AS stock_total,
      (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.product_id=p.id AND r.status='published') AS average_rating,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id=p.id AND r.status='published') AS review_count
     FROM products p LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.id=? AND p.status='active' LIMIT 1`,
    [productId]
  );
  if (!products.length) return null;
  const product = products[0];
  const [variants] = await pool.query(
    "SELECT * FROM product_variants WHERE product_id=? AND is_active=1 ORDER BY size,color_name",
    [productId]
  );
  product.variants = variants;
  return product;
}
// Charge les articles du panier avec leurs variantes et calcule le sous-total.
async function getCartDetails(req) {
  const cart = await getCart(req);
  const [items] = await pool.query(
    `SELECT ci.id AS cart_item_id, ci.quantity, v.id AS variant_id, v.size, v.color_name, v.color_hex,
      v.price, v.stock_quantity, p.id AS product_id, p.name, p.image_url, p.slug
     FROM cart_items ci
     JOIN product_variants v ON v.id=ci.variant_id
     JOIN products p ON p.id=v.product_id
     WHERE ci.cart_id=? AND p.status='active' ORDER BY ci.added_at DESC`,
    [cart.id]
  );
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { cart, items, subtotal };
}

// ATTENTION : route de test d'envoi d'e-mail, publique et avec une adresse factice. À SUPPRIMER avant la mise en production.
app.get("/test-email", async (req, res) => {
  try {
    await sendEmail(
      "YOUR_PERSONAL_EMAIL@gmail.com",
      "Ecrin d'art d'amina - Test d'e-mail",
      `
        <div style="font-family: Arial; padding: 25px;">
          <h2 style="color: #172554;">Ecrin d'art d'amina  </h2>
          <p>Votre système d'e-mail fonctionne correctement !</p>
          <p>Vous pouvez maintenant recevoir les e-mails de récupération de mot de passe.</p>
        </div>
      `
    );

    res.send("E-mail envoyé avec succès !");
  } catch (error) {
    console.error("Échec de l'envoi de l'e-mail :", error);
    res.status(500).send("Échec de l'envoi de l'e-mail.");
  }
});


// =====================================
// MOT DE PASSE OUBLIÉ
// =====================================

// Affiche le formulaire « mot de passe oublié ».
app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", {
    title: "Mot de passe oublié"
  });
});

// Traite la demande : génère un jeton, l'enregistre (haché) et envoie le lien par e-mail.
app.post("/forgot-password", async (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();

    const [users] = await pool.query(
      "SELECT id, email FROM users WHERE email = ? AND is_active = 1",
      [email]
    );

    // Toujours afficher la même réponse, que l'e-mail existe ou non (pour ne pas révéler quels comptes existent).
    req.flash(
      "success",
      "Si cette adresse existe, vous recevrez un lien de réinitialisation."
    );

    if (users.length === 0) {
      return res.redirect("/forgot-password");
    }

    // Génère un jeton aléatoire sécurisé.
    const token = crypto.randomBytes(32).toString("hex");

    // Ne stocke que l'empreinte SHA-256 du jeton.
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Supprime les anciens liens de réinitialisation de cet e-mail.
    await pool.query(
      "DELETE FROM password_resets WHERE email = ?",
      [email]
    );

    // Enregistre le nouveau jeton avec une expiration de 30 minutes.
    await pool.query(
      `INSERT INTO password_resets
       (email, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [email, tokenHash]
    );

    // Lien envoyé par e-mail (nécessite BASE_URL dans le fichier .env).
    const resetLink =
      `${process.env.BASE_URL}/reset-password/${token}`;

    await sendEmail(
      email,
      "Réinitialisation de votre mot de passe - Ecrin d'art d'amina",
      `
        <div style="font-family: Arial; max-width: 550px; margin: auto; padding: 30px;">
          <h2 style="color: #172554;">Ecrin d'art d'amina  </h2>

          <h3>Réinitialisation du mot de passe</h3>

          <p>Nous avons reçu une demande de réinitialisation
          de votre mot de passe.</p>

          <p>Cliquez sur le bouton ci-dessous pour choisir
          un nouveau mot de passe.</p>

          <a href="${resetLink}"
             style="display:inline-block; padding:14px 25px;
             background:#172554; color:white;
             text-decoration:none; border-radius:5px;">
            Réinitialiser mon mot de passe
          </a>

          <p>Ce lien expire dans 30 minutes.</p>

          <p>Si vous n'avez pas demandé cette modification,
          ignorez cet email.</p>

          <p>L'équipe Ecrin d'art d'amina  </p>
        </div>
      `
    );

    res.redirect("/forgot-password");

  } catch (error) {
    console.error("Erreur « mot de passe oublié » :", error);
    req.flash("error", "Impossible d'envoyer le lien. Réessayez plus tard.");
    res.redirect("/forgot-password");
  }
});


// =====================================
// RÉINITIALISATION DU MOT DE PASSE
// =====================================

// Vérifie que le lien est valide (non expiré) puis affiche le formulaire du nouveau mot de passe.
app.get("/reset-password/:token", async (req, res) => {
  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const [rows] = await pool.query(
      `SELECT email FROM password_resets
       WHERE token_hash = ?
       AND expires_at > NOW()`,
      [tokenHash]
    );

    if (rows.length === 0) {
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
    console.error("Erreur de la page de réinitialisation :", error);

    res.status(500).render("error", {
      title: "Erreur",
      message: "Une erreur est survenue."
    });
  }
});


// Enregistre le nouveau mot de passe après vérification de la longueur et de la confirmation.
app.post("/reset-password/:token", async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;

    if (!password || password.length < 8) {
      req.flash("error", "Le mot de passe doit contenir au moins 8 caractères.");
      return res.redirect(
        `/reset-password/${req.params.token}`
      );
    }

    if (password !== confirmPassword) {
      req.flash("error", "Les mots de passe ne correspondent pas.");
      return res.redirect(
        `/reset-password/${req.params.token}`
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const connection = await pool.getConnection();

    try {
      // Transaction : le changement de mot de passe et la suppression des liens se font ensemble, ou pas du tout.
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT email FROM password_resets
         WHERE token_hash = ?
         AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash]
      );

      if (rows.length === 0) {
        await connection.rollback();

        req.flash("error", "Ce lien est invalide ou expiré.");
        return res.redirect("/forgot-password");
      }

      const email = rows[0].email;

      const hashedPassword = await bcrypt.hash(password, 12);

      await connection.query(
        "UPDATE users SET password_hash = ? WHERE email = ?",
        [hashedPassword, email]
      );

      // Invalide tous les liens de réinitialisation de cet e-mail.
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
      await connection.rollback();
      throw error;

    } finally {
      connection.release();
    }

  } catch (error) {
    console.error("Erreur de mise à jour du mot de passe :", error);

    req.flash("error", "Impossible de modifier votre mot de passe.");
    res.redirect("/forgot-password");
  }
});



// Page d'accueil : 8 produits actifs tirés au hasard pour le carrousel.
app.get("/", async (req, res, next) => {
    try {
        const [categories] = await pool.query(
            "SELECT * FROM categories ORDER BY id"
        );

        const [featured] = await pool.query(`
            SELECT
                p.*,
                c.name AS category_name,

                (
                    SELECT MIN(v.price)
                    FROM product_variants v
                    WHERE v.product_id = p.id
                    AND v.is_active = 1
                ) AS from_price,

                (
                    SELECT ROUND(AVG(r.rating), 1)
                    FROM reviews r
                    WHERE r.product_id = p.id
                    AND r.status = 'published'
                ) AS average_rating

            FROM products p

            LEFT JOIN categories c
                ON c.id = p.category_id

            WHERE p.status = 'active'

            ORDER BY RAND()

            LIMIT 8
        `);

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


// Boutique : liste des produits avec filtres (catégorie, type, recherche, taille, couleur, prix) et tri.
app.get("/shop", async (req, res, next) => {
  try {
    const { category, q, sort, type , size, color, min_price, max_price } = req.query;

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

    // Applique les filtres de taille, couleur et prix aux variantes de produits.
    if (size || color || min_price !== undefined || max_price !== undefined) {
      let variantConditions = ["v.product_id = p.id", "v.is_active = 1"];
      const variantParams = [];

      if (size) {
        variantConditions.push("v.size = ?");
        variantParams.push(size);
      }

      if (color) {
        variantConditions.push("v.color_name = ?");
        variantParams.push(color);
      }

      if (min_price !== undefined && min_price !== "") {
        const min = Number(min_price);
        if (Number.isFinite(min) && min >= 0) {
          variantConditions.push("v.price >= ?");
          variantParams.push(min);
        }
      }

      if (max_price !== undefined && max_price !== "") {
        const max = Number(max_price);
        if (Number.isFinite(max) && max >= 0) {
          variantConditions.push("v.price <= ?");
          variantParams.push(max);
        }
      }

      sql += `
        AND EXISTS (
          SELECT 1
          FROM product_variants v
          WHERE ${variantConditions.join(" AND ")}
        )
      `;

      params.push(...variantParams);
    }

    // Correspondance entre le choix de tri et la clause SQL (liste fermée, ce qui évite l'injection SQL).
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

    const [sizes] = await pool.query(`
      SELECT DISTINCT size
      FROM product_variants
      WHERE is_active = 1
      ORDER BY size
    `);

    const [colors] = await pool.query(`
      SELECT DISTINCT color_name
      FROM product_variants
      WHERE is_active = 1
      ORDER BY color_name
    `);

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

// Fiche produit : variantes et avis publiés.
app.get("/product/:slug", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT id FROM products WHERE slug=? AND status='active' LIMIT 1", [req.params.slug]);
    if (!rows.length) return res.status(404).render("error", { title: "Introuvable", message: "Ce produit n'est pas disponible." });
    const product = await getProduct(rows[0].id);
    const [reviews] = await pool.query(
      `SELECT r.*,u.full_name FROM reviews r JOIN users u ON u.id=r.user_id
       WHERE r.product_id=? AND r.status='published' ORDER BY r.created_at DESC`,
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
  } catch (err) { next(err); }
});

// Inscription : formulaire (GET) puis création du compte (POST).
app.get("/register", (req, res) => res.render("auth/register", { title: "Créer un compte" }));
// Vérifie les champs, hache le mot de passe (bcrypt) et crée le compte client.
app.post("/register", async (req, res, next) => {
  try {
    const { full_name, email, phone, password, confirm_password } = req.body;
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
      "INSERT INTO users (full_name,email,phone,password_hash,role) VALUES (?,?,?,?, 'customer')",
      [full_name.trim(), email.trim().toLowerCase(), phone || null, hash]
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
// Connexion : formulaire (GET) puis vérification de l'e-mail et du mot de passe (POST).
app.get("/login", (req, res) => res.render("auth/login", { title: "Connexion" }));
app.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const [rows] = await pool.query("SELECT * FROM users WHERE email=? AND is_active=1 LIMIT 1", [email]);
    if (!rows.length || !(await bcrypt.compare(req.body.password || "", rows[0].password_hash))) {
      req.flash("error", "L'e-mail ou le mot de passe est incorrect.");
      return res.redirect("/login");
    }
    // Nouvelle session après la connexion (protège contre le vol de session) ; on y garde les infos du profil.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = {
        id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email,
        phone: rows[0].phone, role: rows[0].role,
        profile_image: rows[0].profile_image, theme: rows[0].theme,
        language: rows[0].language, currency: rows[0].currency
      };
      req.flash("success", `Bon retour, ${rows[0].full_name}.`);
      res.redirect(rows[0].role === "admin" ? "/admin" : "/account");
    });
  } catch (err) { next(err); }
});
// Déconnexion : détruit la session.
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Mon compte : les 30 dernières commandes de l'utilisateur.
app.get("/account", requireLogin, async (req, res, next) => {
  try {
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
      [req.session.user.id]
    );
    res.render("account", { title: "Mon compte", orders });
  } catch (err) { next(err); }
});

// Paramètres : affiche le profil enregistré.
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
  } catch (error) {
    next(error);
  }
});

// Enregistre le profil : nom, téléphone, photo, thème, langue et devise (valeurs contrôlées).
app.post("/settings/profile", requireLogin, upload.single("profile_image"), async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || "").trim();
    const phone = String(req.body.phone || "").trim();
    const theme = ["light", "dark", "system"].includes(req.body.theme)
      ? req.body.theme : "system";
    const language = ["fr"].includes(req.body.language)
      ? req.body.language : "fr";
    const currency = ["CDF", "USD"].includes(req.body.currency)
      ? req.body.currency : "CDF";

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
      [fullName, phone || null, profileImage, theme, language, currency, req.session.user.id]
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
  } catch (error) {
    next(error);
  }
});

// Changement de mot de passe : vérifie l'ancien, la longueur (8 minimum) et la confirmation.
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
  } catch (error) {
    next(error);
  }
});

// Pages légales.
app.get("/conditions-generales", (req, res) => {
  res.render("legal", { title: "Conditions générales", page: "terms" });
});

app.get("/cookies", (req, res) => {
  res.render("legal", { title: "Politique relative aux cookies", page: "cookies" });
});

// Panier : affiche les articles et le sous-total.
app.get("/cart", async (req, res, next) => {
  try {
    const cart = await getCartDetails(req);
    res.render("cart", { title: "Panier", ...cart });
  } catch (err) { next(err); }
});
// Ajoute une variante au panier (quantité de 1 à 20, limitée au stock disponible).
app.post("/cart/add", async (req, res, next) => {
  try {
    const variantId = Number(req.body.variant_id);
    const quantity = Math.max(1, Math.min(20, Number(req.body.quantity || 1)));
    const [[variant]] = await pool.query(
      `SELECT v.*,p.id AS product_id FROM product_variants v
       JOIN products p ON p.id=v.product_id
       WHERE v.id=? AND v.is_active=1 AND p.status='active'`,
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
      `INSERT INTO cart_items (cart_id,variant_id,quantity) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE quantity=LEAST(quantity+VALUES(quantity),?)`,
      [cart.id, variantId, quantity, variant.stock_quantity]
    );
    track(req, "add_to_cart", variant.product_id, { variantId, quantity });
    req.flash("success", "Ajouté à votre panier.");
    res.redirect(req.get("referer") || "/cart");
  } catch (err) { next(err); }
});
// Modifie la quantité d'un article (0 = le retirer).
app.post("/cart/update", async (req, res, next) => {
  try {
    const cart = await getCart(req);
    const itemId = Number(req.body.cart_item_id);
    const quantity = Number(req.body.quantity);
    if (quantity <= 0) {
      await pool.query("DELETE FROM cart_items WHERE id=? AND cart_id=?", [itemId, cart.id]);
      track(req, "remove_from_cart");
    } else {
      await pool.query(
        `UPDATE cart_items ci JOIN product_variants v ON v.id=ci.variant_id
         SET ci.quantity=LEAST(?,v.stock_quantity) WHERE ci.id=? AND ci.cart_id=?`,
        [Math.min(20, quantity), itemId, cart.id]
      );
    }
    res.redirect("/cart");
  } catch (err) { next(err); }
});
// Retire un article du panier.
app.post("/cart/remove", async (req, res, next) => {
  try {
    const cart = await getCart(req);
    await pool.query("DELETE FROM cart_items WHERE id=? AND cart_id=?", [Number(req.body.cart_item_id), cart.id]);
    track(req, "remove_from_cart");
    res.redirect("/cart");
  } catch (err) { next(err); }
});

// Page de commande : refusée si le panier est vide.
app.get("/checkout", async (req, res, next) => {
  try {
    const cart = await getCartDetails(req);
    if (!cart.items.length) {
      req.flash("error", "Votre panier est vide.");
      return res.redirect("/shop");
    }
    track(req, "checkout_started");
    res.render("checkout", { title: "Commande", ...cart });
  } catch (err) { next(err); }
});
// Validation de la commande dans une transaction : contrôle des champs, verrouillage du stock, création de la commande, des lignes, du paiement et de l'historique.
app.post("/checkout", async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { customer_name, customer_email, customer_phone, shipping_country, shipping_city,
      shipping_address, payment_method, customer_note, payer_phone } = req.body;
    const allowed = ["airtel_money", "card", "cash_on_delivery"];
    if (!customer_name || !customer_phone || !shipping_city || !shipping_address || !allowed.includes(payment_method)) {
      req.flash("error", "Veuillez remplir tous les champs obligatoires de la commande.");
      return res.redirect("/checkout");
    }
    if (payment_method === "airtel_money" && !/^\+243\d{9}$/.test(String(payer_phone || "").replace(/\s/g, ""))) {
      req.flash("error", "Pour Airtel Money RDC, utilisez un numéro du type +2439XXXXXXXX.");
      return res.redirect("/checkout");
    }
    const cart = await getCartDetails(req);
    if (!cart.items.length) {
      req.flash("error", "Votre panier est vide.");
      return res.redirect("/shop");
    }
    await conn.beginTransaction();
    // Verrouille les lignes de stock pour éviter la survente en cas de commandes simultanées.
    for (const item of cart.items) {
      const [stockRows] = await conn.query("SELECT stock_quantity FROM product_variants WHERE id=? FOR UPDATE", [item.variant_id]);
      if (!stockRows.length || stockRows[0].stock_quantity < item.quantity) {
        throw new Error(`Stock insuffisant pour ${item.name}. Veuillez mettre à jour votre panier.`);
      }
    }
    const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryFee = 0; // L'administrateur pourra configurer les frais de livraison dans un futur écran de paramètres.
    const total = subtotal + deliveryFee;
    // Numéro de commande unique (préfixe + date + code aléatoire).
    const orderNumber = `ASH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const userId = req.session.user ? req.session.user.id : null;
    // Statut initial du paiement selon le mode choisi (Airtel Money : en attente de confirmation).
    const paymentStatus = payment_method === "cash_on_delivery" ? "pending" :
      payment_method === "airtel_money" ? "awaiting_confirmation" : "pending";
    const [orderResult] = await conn.query(
      `INSERT INTO orders (order_number,user_id,customer_name,customer_email,customer_phone,
       shipping_country,shipping_city,shipping_address,currency,subtotal,delivery_fee,total,
       payment_method,payment_status,order_status,customer_note)
       VALUES (?,?,?,?,?,?,?,?, 'USD',?,?,?,?,?, 'pending',?)`,
      [orderNumber,userId,customer_name,customer_email || null,customer_phone,shipping_country || "RD Congo",
       shipping_city,shipping_address,subtotal,deliveryFee,total,payment_method,paymentStatus,customer_note || null]
    );
    for (const item of cart.items) {
      await conn.query(
        `INSERT INTO order_items (order_id,variant_id,product_name,size,color_name,color_hex,unit_price,quantity,line_total)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [orderResult.insertId,item.variant_id,item.name,item.size,item.color_name,item.color_hex,item.price,item.quantity,item.price*item.quantity]
      );
      await conn.query("UPDATE product_variants SET stock_quantity=stock_quantity-? WHERE id=?", [item.quantity,item.variant_id]);
    }
    await conn.query(
      `INSERT INTO payments (order_id,provider,amount,currency,status,payer_phone)
       VALUES (?,?,?,'USD',?,?)`,
      [orderResult.insertId,payment_method,total,paymentStatus,payment_method === "airtel_money" ? payer_phone : null]
    );
    await conn.query(
      "INSERT INTO order_status_history (order_id,old_status,new_status,changed_by,note) VALUES (?,NULL,'pending',?,'Commande passée')",
      [orderResult.insertId,userId]
    );
    await conn.query("UPDATE carts SET status='converted' WHERE id=?", [cart.cart.id]);
    await conn.commit();
    track(req, "order_placed", null, { orderNumber });
    res.render("order-success", { title: "Commande reçue", orderNumber, paymentMethod: payment_method });
  } catch (err) {
    await conn.rollback();
    req.flash("error", err.message || "Impossible de passer votre commande.");
    res.redirect("/checkout");
  } finally {
    conn.release();
  }
});

// Ajoute ou met à jour un avis ; il reste « en attente » jusqu'à sa modération.
app.post("/product/:id/review", requireLogin, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim().slice(0, 2000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      req.flash("error", "Choisissez une note de 1 à 5.");
      return res.redirect(req.get("referer") || "/shop");
    }
    await pool.query(
      `INSERT INTO reviews (user_id,product_id,rating,comment,status) VALUES (?,?,?,?, 'pending')
       ON DUPLICATE KEY UPDATE rating=VALUES(rating),comment=VALUES(comment),status='pending',created_at=CURRENT_TIMESTAMP`,
      [req.session.user.id, productId, rating, comment || null]
    );
    req.flash("success", "Merci ! Votre avis apparaîtra après modération.");
    res.redirect(req.get("referer") || "/shop");
  } catch (err) { next(err); }
});

/* Tableau de bord administrateur */
// Tableau de bord : indicateurs, commandes récentes et activité récente.
app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const [[stats]] = await pool.query(`
      SELECT
      (SELECT COUNT(*) FROM users WHERE role='customer') AS customers,
      (SELECT COUNT(*) FROM products WHERE status<>'archived') AS products,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE payment_status='paid') AS revenue,
      (SELECT COUNT(*) FROM orders WHERE order_status IN ('pending','confirmed','processing')) AS open_orders,
      (SELECT COUNT(*) FROM carts WHERE status='active' AND last_activity >= NOW() - INTERVAL 30 DAY) AS active_carts
    `);
    const [recentOrders] = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 8");
    const [recentActivity] = await pool.query(
      `SELECT a.*,u.full_name,p.name AS product_name FROM client_activity a
       LEFT JOIN users u ON u.id=a.user_id LEFT JOIN products p ON p.id=a.product_id
       ORDER BY a.created_at DESC LIMIT 12`
    );
    res.render("admin/dashboard", { title: "Tableau de bord", stats, recentOrders, recentActivity });
  } catch (err) { next(err); }
});
// Liste des produits (y compris brouillons et archivés) avec prix de départ et stock.
app.get("/admin/products", requireAdmin, async (req, res, next) => {
  try {
    const [products] = await pool.query(
      `SELECT p.*,c.name AS category_name,
       (SELECT MIN(price) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=1) AS from_price,
       (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants v WHERE v.product_id=p.id AND v.is_active=1) AS stock_total
       FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.created_at DESC`
    );
    res.render("admin/products", { title: "Gestion des produits", products });
  } catch (err) { next(err); }
});
// Formulaire de création d'un produit.
app.get("/admin/products/new", requireAdmin, async (req, res, next) => {
  try {
    const [categories] = await pool.query("SELECT * FROM categories ORDER BY name");
    res.render("admin/product-form", { title: "Ajouter un produit", categories, product: null, variants: [] });
  } catch (err) { next(err); }
});
// Crée un produit et ses variantes (liste JSON envoyée par le formulaire).
app.post("/admin/products", requireAdmin, upload.single("image"), async (req, res, next) => {
  try {
    const { name, category_id, description, status, featured, variants_json } = req.body;
    if (!name || !variants_json) {
      req.flash("error", "Le nom du produit et au moins une variante taille/couleur sont obligatoires.");
      return res.redirect("/admin/products/new");
    }
    const variants = JSON.parse(variants_json);
    if (!Array.isArray(variants) || !variants.length) throw new Error("Ajoutez au moins une variante.");
    const slugBase = slugify(name);
    const slug = `${slugBase}-${crypto.randomBytes(2).toString("hex")}`;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const [result] = await pool.query(
      "INSERT INTO products (category_id,name,slug,description,image_url,status,featured) VALUES (?,?,?,?,?,?,?)",
      [category_id || null,name.trim(),slug,description || null,imageUrl,["active","draft","archived"].includes(status) ? status : "active",featured ? 1 : 0]
    );
    for (const v of variants) {
      const price = Number(v.price);
      const stock = Math.max(0, Math.floor(Number(v.stock_quantity || 0)));
      if (!v.size || !v.color_name || !/^#[0-9a-fA-F]{6}$/.test(v.color_hex) || !Number.isFinite(price) || price < 0) {
        throw new Error("Vérifiez la taille, la couleur, le code couleur et le prix de chaque variante.");
      }
      await pool.query(
        "INSERT INTO product_variants (product_id,size,color_name,color_hex,price,stock_quantity,sku) VALUES (?,?,?,?,?,?,?)",
        [result.insertId,v.size,v.color_name,v.color_hex,price,stock,v.sku || null]
      );
    }
    req.flash("success", "Produit créé.");
    res.redirect("/admin/products");
  } catch (err) { next(err); }
});
// Formulaire de modification d'un produit.
app.get("/admin/products/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const [[product]] = await pool.query("SELECT * FROM products WHERE id=?", [Number(req.params.id)]);
    if (!product) return res.redirect("/admin/products");
    const [categories] = await pool.query("SELECT * FROM categories ORDER BY name");
    const [variants] = await pool.query("SELECT * FROM product_variants WHERE product_id=? ORDER BY id", [product.id]);
    res.render("admin/product-form", { title: "Modifier le produit", categories, product, variants });
  } catch (err) { next(err); }
});
// Met à jour le produit ; les variantes absentes de la liste sont désactivées (et non supprimées).
app.post("/admin/products/:id", requireAdmin, upload.single("image"), async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const { name, category_id, description, status, featured, variants_json } = req.body;
    const variants = JSON.parse(variants_json || "[]");
    if (!name || !variants.length) throw new Error("Le nom du produit et au moins une variante sont obligatoires.");
    const [oldRows] = await pool.query("SELECT image_url FROM products WHERE id=?", [productId]);
    if (!oldRows.length) return res.redirect("/admin/products");
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : oldRows[0].image_url;
    await pool.query(
      "UPDATE products SET category_id=?,name=?,description=?,image_url=?,status=?,featured=? WHERE id=?",
      [category_id || null,name.trim(),description || null,imageUrl,["active","draft","archived"].includes(status) ? status : "active",featured ? 1 : 0,productId]
    );
    const incomingIds = [];
    for (const v of variants) {
      const price = Number(v.price);
      const stock = Math.max(0, Math.floor(Number(v.stock_quantity || 0)));
      if (!v.size || !v.color_name || !/^#[0-9a-fA-F]{6}$/.test(v.color_hex) || !Number.isFinite(price) || price < 0) {
        throw new Error("Vérifiez la taille, la couleur, le code couleur et le prix de chaque variante.");
      }
      if (v.id) {
        await pool.query(
          "UPDATE product_variants SET size=?,color_name=?,color_hex=?,price=?,stock_quantity=?,sku=?,is_active=1 WHERE id=? AND product_id=?",
          [v.size,v.color_name,v.color_hex,price,stock,v.sku || null,v.id,productId]
        );
        incomingIds.push(Number(v.id));
      } else {
        const [insert] = await pool.query(
          "INSERT INTO product_variants (product_id,size,color_name,color_hex,price,stock_quantity,sku) VALUES (?,?,?,?,?,?,?)",
          [productId,v.size,v.color_name,v.color_hex,price,stock,v.sku || null]
        );
        incomingIds.push(insert.insertId);
      }
    }
    if (incomingIds.length) {
      await pool.query(`UPDATE product_variants SET is_active=0 WHERE product_id=? AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
        [productId,...incomingIds]);
    }
    req.flash("success", "Produit mis à jour.");
    res.redirect("/admin/products");
  } catch (err) { next(err); }
});
// Archive un produit (il disparaît de la boutique mais reste en base).
app.post("/admin/products/:id/archive", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("UPDATE products SET status='archived' WHERE id=?", [Number(req.params.id)]);
    req.flash("success", "Produit archivé.");
    res.redirect("/admin/products");
  } catch (err) { next(err); }
});

// Liste des 250 dernières commandes.
app.get("/admin/orders", requireAdmin, async (req, res, next) => {
  try {
    const [orders] = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250");
    res.render("admin/orders", { title: "Suivi des commandes", orders });
  } catch (err) { next(err); }
});
// Change le statut d'une commande et l'enregistre dans l'historique.
app.post("/admin/orders/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const allowed = ["pending","confirmed","processing","shipped","delivered","cancelled"];
    const status = req.body.order_status;
    if (!allowed.includes(status)) throw new Error("Statut de commande invalide.");
    const [[order]] = await pool.query("SELECT order_status FROM orders WHERE id=?", [orderId]);
    if (!order) return res.redirect("/admin/orders");
    await pool.query("UPDATE orders SET order_status=? WHERE id=?", [status,orderId]);
    await pool.query(
      "INSERT INTO order_status_history (order_id,old_status,new_status,changed_by,note) VALUES (?,?,?,?,?)",
      [orderId,order.order_status,status,req.session.user.id,req.body.note || null]
    );
    req.flash("success", "Statut de la commande mis à jour.");
    res.redirect("/admin/orders");
  } catch (err) { next(err); }
});
// Liste des 250 derniers paiements.
app.get("/admin/payments", requireAdmin, async (req, res, next) => {
  try {
    const [payments] = await pool.query(
      `SELECT pay.*,o.order_number,o.customer_name,o.customer_phone,o.payment_method
       FROM payments pay JOIN orders o ON o.id=pay.order_id ORDER BY pay.created_at DESC LIMIT 250`
    );
    res.render("admin/payments", { title: "Suivi des paiements", payments });
  } catch (err) { next(err); }
});
// Met à jour un paiement et le statut de paiement de la commande liée (transaction).
app.post("/admin/payments/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const paymentId = Number(req.params.id);
    const allowed = ["pending","paid","failed","refunded","awaiting_confirmation"];
    const status = req.body.status;
    if (!allowed.includes(status)) throw new Error("Statut de paiement invalide.");
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[payment]] = await conn.query("SELECT * FROM payments WHERE id=? FOR UPDATE", [paymentId]);
      if (!payment) { await conn.rollback(); return res.redirect("/admin/payments"); }
      await conn.query(
        "UPDATE payments SET status=?,provider_reference=?,admin_note=?,confirmed_by=?,confirmed_at=IF(?='paid',NOW(),confirmed_at) WHERE id=?",
        [status,req.body.provider_reference || null,req.body.admin_note || null,req.session.user.id,status,paymentId]
      );
      await conn.query("UPDATE orders SET payment_status=? WHERE id=?", [status,payment.order_id]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
    req.flash("success", "Suivi du paiement mis à jour. Vérifiez l'argent reçu sur le tableau de bord du prestataire avant de le marquer comme payé.");
    res.redirect("/admin/payments");
  } catch (err) { next(err); }
});
// Répertoire des clients avec nombre de commandes et total payé.
app.get("/admin/customers", requireAdmin, async (req, res, next) => {
  try {
    const [customers] = await pool.query(
      `SELECT u.id,u.full_name,u.email,u.phone,u.is_active,u.created_at,
       COUNT(DISTINCT o.id) AS order_count,COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total ELSE 0 END),0) AS paid_total
       FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer'
       GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.render("admin/customers", { title: "Suivi des clients", customers });
  } catch (err) { next(err); }
});
// Paniers actifs et abandonnés avec leur contenu.
app.get("/admin/carts", requireAdmin, async (req, res, next) => {
  try {
    const [carts] = await pool.query(
      `SELECT c.*,u.full_name,u.email,COUNT(ci.id) AS item_count,
       COALESCE(SUM(ci.quantity*v.price),0) AS cart_value,
       GROUP_CONCAT(CONCAT(p.name,' (',v.size,' / ',v.color_name,') × ',ci.quantity) SEPARATOR ' | ') AS items
       FROM carts c LEFT JOIN users u ON u.id=c.user_id
       LEFT JOIN cart_items ci ON ci.cart_id=c.id LEFT JOIN product_variants v ON v.id=ci.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       WHERE c.status IN ('active','abandoned') GROUP BY c.id ORDER BY c.last_activity DESC LIMIT 250`
    );
    res.render("admin/carts", { title: "Suivi des paniers", carts });
  } catch (err) { next(err); }
});
// Avis à modérer (les « en attente » d'abord).
app.get("/admin/reviews", requireAdmin, async (req, res, next) => {
  try {
    const [reviews] = await pool.query(
      `SELECT r.*,u.full_name,p.name AS product_name FROM reviews r
       JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id
       ORDER BY FIELD(r.status,'pending','published','hidden'),r.created_at DESC`
    );
    res.render("admin/reviews", { title: "Modération des avis", reviews });
  } catch (err) { next(err); }
});
// Publie, masque ou remet en attente un avis.
app.post("/admin/reviews/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const status = ["pending","published","hidden"].includes(req.body.status) ? req.body.status : "pending";
    await pool.query("UPDATE reviews SET status=? WHERE id=?", [status,Number(req.params.id)]);
    req.flash("success", "Statut de l'avis mis à jour.");
    res.redirect("/admin/reviews");
  } catch (err) { next(err); }
});
// Journal des 500 dernières activités des clients.
app.get("/admin/activity", requireAdmin, async (req, res, next) => {
  try {
    const [activity] = await pool.query(
      `SELECT a.*,u.full_name,p.name AS product_name FROM client_activity a
       LEFT JOIN users u ON u.id=a.user_id LEFT JOIN products p ON p.id=a.product_id
       ORDER BY a.created_at DESC LIMIT 500`
    );
    res.render("admin/activity", { title: "Activité des clients", activity });
  } catch (err) { next(err); }
});

// Suivi de commande : visible par son propriétaire ou par un administrateur.
app.get("/order/:orderNumber", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM orders WHERE order_number=? LIMIT 1", [req.params.orderNumber]);
    if (!rows.length) return res.status(404).render("error", { title: "Commande introuvable", message: "Nous n'avons pas trouvé cette commande." });
    const order = rows[0];
    if (order.user_id && (!req.session.user || (req.session.user.id !== order.user_id && req.session.user.role !== "admin"))) {
      return res.status(403).render("error", { title: "Accès refusé", message: "Connectez-vous pour voir cette commande." });
    }
    const [items] = await pool.query("SELECT * FROM order_items WHERE order_id=?", [order.id]);
    const [history] = await pool.query("SELECT * FROM order_status_history WHERE order_id=? ORDER BY created_at", [order.id]);
    res.render("order-track", { title: "Suivi de la commande", order, items, history });
  } catch (err) { next(err); }
});
// Anciennes adresses anglaises
app.get("/women", (req, res) => res.redirect("/femme"));
app.get("/men", (req, res) => res.redirect("/homme"));
app.get("/kids", (req, res) => res.redirect("/enfants"));
app.get("/accessories", (req, res) => res.redirect("/accessoires"));

// Pages françaises
// Redirections des pages par catégorie vers la boutique filtrée.
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

// Page 404 : aucune route ne correspond.
app.use((req, res) => res.status(404).render("error", { title: "Page introuvable", message: "Nous n'avons pas trouvé cette page." }));
// Gestionnaire d'erreurs global : erreurs d'envoi d'image, puis erreur serveur 500 (détail masqué en production).
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    req.flash("error", err.code === "LIMIT_FILE_SIZE" ? "L'image ne doit pas dépasser 5 Mo." : "Échec du téléversement de l'image.");
    return res.redirect(req.get("referer") || "/admin/products");
  }
  res.status(500).render("error", {
    title: "Une erreur est survenue",
    message: process.env.NODE_ENV === "production" ? "Veuillez réessayer plus tard." : (err.message || "Erreur inattendue du serveur.")
  });
});



// Crée le compte administrateur au premier démarrage à partir de ADMIN_EMAIL et ADMIN_PASSWORD du fichier .env.
async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password === "ChangeThisAdminPassword123!") {
    console.warn("Création de l'administrateur ignorée. Définissez ADMIN_EMAIL et un ADMIN_PASSWORD robuste dans le fichier .env.");
    return;
  }
  const [existing] = await pool.query("SELECT id FROM users WHERE email=? LIMIT 1", [email.toLowerCase()]);
  if (!existing.length) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,'admin')",
      [process.env.ADMIN_NAME || "Administrateur", email.toLowerCase(), hash]
    );
    console.log(`Compte administrateur créé pour ${email}`);
  }
}

// Démarrage : test de MySQL, création de l'administrateur, puis écoute du serveur.
(async () => {
  try {
    await pool.query("SELECT 1");
    await bootstrapAdmin();
    app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ecrin d'art d'amina fonctionne sur le port ${PORT}`);
});
});
  } catch (err) {
    console.error("Connexion à MySQL impossible. Vérifiez votre fichier .env et importez database/schema.sql.", err.message);
    process.exit(1);
  }
})();

# Ashion Fashion Store

A responsive fashion ecommerce starter based on the supplied Ashion reference screenshot. Built with HTML/EJS templates, CSS, vanilla JavaScript, Node.js/Express and MySQL.

## Included

- Responsive storefront with category tiles, search, category filtering and product cards
- Customer registration/login with bcrypt password hashing and MySQL-backed sessions
- MySQL schema for users, categories, products, size/color variants, carts, orders, payments, status history, reviews and client activity
- Admin dashboard with revenue/order/customer/product/cart summaries
- Admin product image upload, product editing, size/color variants, per-variant prices and stock quantities
- Order tracking and fulfilment status updates
- Payment tracking for Airtel Money DRC, card and cash on delivery
- Customer directory, activity tracking, abandoned/active carts, review moderation
- Customer ratings and comments (moderated before publication)
- Responsive mobile navigation and mobile-friendly layouts

## Requirements

- Node.js 18+ recommended
- MySQL 8+
- npm

## Setup on Windows

1. Install Node.js and MySQL Server. Open Command Prompt in this project folder.
2. Create the database:
   ```bat
   mysql -u root -p < database\schema.sql
   ```
   Or open MySQL Workbench, run all of `database/schema.sql`.
3. Copy `.env.example` to `.env` and edit the values:
   ```bat
   copy .env.example .env
   ```
4. Set a strong `SESSION_SECRET`, your MySQL password, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`. The default placeholder admin password is deliberately not bootstrapped.
5. Install dependencies and start:
   ```bat
   npm install
   npm start
   ```
6. Visit `http://localhost:3000`. Sign in using the admin email/password you set in `.env`.

## Admin product setup

Go to **Admin → Products & stock → Add product**. Upload a product image and add one or more size/color variants. Each variant has its own price, stock and optional SKU. For example:
- M / Black / $25 / stock 8
- XL / Black / $29 / stock 4
- M / White / $26 / stock 6

The product page calculates the displayed price from the exact selected variant.

## Payment integration status (important)

This project **records** payment methods and statuses but does not yet collect live money:
- **Airtel Money DRC (+243):** records the payer number and starts in `awaiting_confirmation`. Admin must verify the transaction through the provider before marking it paid. To automate this, integrate an officially supported Airtel Money merchant API and signed server-side callback/webhook.
- **Card:** order is recorded as pending. Connect a compliant payment processor (for example a provider that supports your business/country) before accepting live card payments. Never collect or store raw card numbers, CVV or expiry in this application.
- **Cash on delivery:** order is recorded as pending and paid status should only be updated after collection.

Amounts currently use USD. Delivery fee is currently zero in the order calculation and shown as confirmed by the store; configure real city-based delivery rates before production.

## Security and production checklist

This is a starter project, not yet a production-certified commerce system. Before public launch:
- Use HTTPS and a strong secret; configure secure cookies and reverse-proxy trust correctly
- Add CSRF protection to all state-changing forms, rate limiting, login throttling and stronger validation
- Add email verification, password reset, privacy/consent notice and data retention controls
- Move image uploads to object storage/CDN, scan uploads, and add file cleanup
- Add real Airtel Money/card provider integration, webhook signature verification and idempotency
- Add transactional stock/order handling for all admin product edits and stronger recovery logic
- Configure delivery pricing, tax, currency and refunds
- Add automated tests, backups and monitoring
- Ensure MySQL user has only the necessary database permissions

## Project structure

```text
ashion_store/
├── database/schema.sql
├── public/
│   ├── css/style.css
│   ├── js/main.js
│   └── uploads/
├── views/
│   ├── admin/
│   ├── auth/
│   └── partials/
├── .env.example
├── package.json
└── server.js
```

## Import your existing product catalogue

The project includes `database/import-products.json`, containing the 152 products from your supplied catalogue. After creating the database and configuring `.env`, run:

```bat
npm run import-products
```

The importer creates categories, products, image galleries, and every size/color combination. Each generated variant starts at the product's existing base price and **stock 0**. The admin must set the real price and stock for each combination before selling. The importer can be run again safely: it updates the imported products and rebuilds their variants instead of duplicating them. Back up your database before re-importing because manually edited variant prices and stock for those imported products will be reset to the catalogue base price and zero stock.


## Paramètres du compte et pages légales

Les clients connectés peuvent ouvrir `/settings` pour modifier leur photo de profil, leur thème, leur langue, leur devise et leur mot de passe. Les pages `/conditions-generales` et `/cookies` sont également disponibles.

### Mise à jour de la base existante

Si la base `ashion_store` existe déjà, exécutez une seule fois `database/migrate-settings.sql` dans MySQL. Si vous créez une base neuve, les colonnes sont déjà incluses dans `database/schema.sql` : ne lancez pas aussi le fichier de migration, car les colonnes seraient ajoutées deux fois.

### À noter

- Les choix de thème, langue et devise sont enregistrés. La mise en forme du thème clair/sombre est appliquée côté navigateur.
- La devise est un réglage de préférence ; les montants existants ne sont pas convertis automatiquement entre CDF et USD. Définissez votre logique de conversion/prix avant la mise en production.
- La sélection de langue est enregistrée, mais les traductions complètes de toutes les pages restent à finaliser.
- Les textes juridiques sont des modèles à adapter à vos pratiques réelles de livraison, retour et protection des données.
- Le serveur écoute désormais sur `0.0.0.0` pour permettre les tests sur téléphone connecté au même Wi-Fi.
"# ecrin-d-art-d-amina-v2" 

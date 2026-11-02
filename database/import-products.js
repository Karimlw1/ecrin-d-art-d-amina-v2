require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const productsFile = path.join(__dirname, 'import-products.json');
const productsData = JSON.parse(fs.readFileSync(productsFile, 'utf8'));

function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
}

async function importProducts() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ashion_store'
  });

  let imported = 0;
  let variantCount = 0;

  try {
    await db.beginTransaction();

    for (const [sourceId, item] of Object.entries(productsData)) {
      const categoryName = String(item.category || 'Other').trim().slice(0, 100);
      const categorySlug = slugify(categoryName) || 'other';
      await db.query(
        `INSERT INTO categories (name, slug) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name)`,
        [categoryName, categorySlug]
      );
      const [[category]] = await db.query('SELECT id FROM categories WHERE name=?', [categoryName]);

      const fullName = String(item.name || `Product ${sourceId}`).trim();
      const productName = fullName.slice(0, 180);
      const slug = `${slugify(productName).slice(0, 125) || 'product'}-${slugify(sourceId).slice(0, 30)}`;
      const images = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
      const mainImage = item.image || images[0] || null;
      const basePrice = Number(item.price || 0);
      if (!Number.isFinite(basePrice) || basePrice < 0) throw new Error(`Invalid price for product ${sourceId}`);

      const [result] = await db.query(
        `INSERT INTO products (category_id, name, slug, description, image_url, image_gallery, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE category_id=VALUES(category_id), name=VALUES(name),
           description=VALUES(description), image_url=VALUES(image_url), image_gallery=VALUES(image_gallery),
           status='active', id=LAST_INSERT_ID(id)`,
        [category.id, productName, slug, fullName, mainImage, JSON.stringify(images)]
      );
      const productId = result.insertId;

      // Rebuild imported variants so running this importer again does not duplicate them.
      await db.query('DELETE FROM product_variants WHERE product_id=?', [productId]);
      const sizes = Array.isArray(item.options?.size) && item.options.size.length ? item.options.size : ['One size'];
      const colors = Array.isArray(item.options?.color) && item.options.color.length ? item.options.color : ['Default'];

         let variantNumber = 1;

      for (const size of sizes) {
        for (const color of colors) {
          const safeSize = String(size).slice(0, 40);
          const safeColor = String(color).slice(0, 60);

          // Product ID + variant number guarantees a unique SKU.
          const sku = `ASH-${productId}-${variantNumber}`;

          await db.query(
            `INSERT INTO product_variants
             (product_id, size, color_name, color_hex, price, stock_quantity, sku)
             VALUES (?, ?, ?, '#222222', ?, 0, ?)`,
            [productId, safeSize, safeColor, basePrice, sku]
          );

          variantNumber++;
          variantCount++;
        }
      }
      imported++;
    }

    await db.commit();
    console.log(`Import complete: ${imported} products and ${variantCount} size/color variants.`);
    console.log('Initial variant prices use each product base price. Stock is set to 0 until the admin enters real quantities.');
  } catch (error) {
    await db.rollback();
    console.error('Import failed. Changes were rolled back.');
    throw error;
  } finally {
    await db.end();
  }
}

importProducts().catch(error => {
  console.error(error.message);
  process.exit(1);
});

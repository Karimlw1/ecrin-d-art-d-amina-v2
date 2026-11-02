CREATE DATABASE IF NOT EXISTS ashion_store
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ashion_store;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(30),
  profile_image VARCHAR(500) NULL,
  theme ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  language ENUM('fr','en') NOT NULL DEFAULT 'fr',
  currency ENUM('CDF','USD') NOT NULL DEFAULT 'CDF',
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_created (created_at)
);

CREATE TABLE IF NOT EXISTS addresses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  country VARCHAR(80) NOT NULL DEFAULT 'DR Congo',
  city VARCHAR(100) NOT NULL,
  address_line VARCHAR(255) NOT NULL,
  notes VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT UNSIGNED NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  image_url VARCHAR(500),
  image_gallery JSON NULL,
  status ENUM('active','draft','archived') NOT NULL DEFAULT 'active',
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_products_status (status),
  INDEX idx_products_category (category_id)
);

-- Each size/color combination can have its own admin-defined price and stock.
CREATE TABLE IF NOT EXISTS product_variants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  size VARCHAR(40) NOT NULL DEFAULT 'One size',
  color_name VARCHAR(60) NOT NULL DEFAULT 'Default',
  color_hex CHAR(7) NOT NULL DEFAULT '#222222',
  price DECIMAL(12,2) NOT NULL,
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  sku VARCHAR(100) UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_variant_product (product_id),
  CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS carts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  session_key VARCHAR(128) NULL,
  status ENUM('active','converted','abandoned') NOT NULL DEFAULT 'active',
  last_activity TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cart_status_activity (status,last_activity),
  INDEX idx_cart_session (session_key)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cart_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cart_variant (cart_id,variant_id),
  CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(190),
  customer_phone VARCHAR(30) NOT NULL,
  shipping_country VARCHAR(80) NOT NULL DEFAULT 'DR Congo',
  shipping_city VARCHAR(100) NOT NULL,
  shipping_address VARCHAR(255) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method ENUM('airtel_money','card','cash_on_delivery') NOT NULL,
  payment_status ENUM('pending','paid','failed','refunded','awaiting_confirmation') NOT NULL DEFAULT 'pending',
  order_status ENUM('pending','confirmed','processing','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  customer_note VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_status (order_status),
  INDEX idx_orders_payment (payment_status),
  INDEX idx_orders_created (created_at)
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(180) NOT NULL,
  size VARCHAR(40) NOT NULL,
  color_name VARCHAR(60) NOT NULL,
  color_hex CHAR(7) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('airtel_money','card','cash_on_delivery') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('pending','initiated','paid','failed','refunded','awaiting_confirmation') NOT NULL DEFAULT 'pending',
  provider_reference VARCHAR(190),
  payer_phone VARCHAR(30),
  admin_note VARCHAR(500),
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_admin FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_payments_status (status)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  old_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  note VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_history_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT,
  status ENUM('pending','published','hidden') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  UNIQUE KEY uq_review_user_product (user_id,product_id),
  CHECK (rating BETWEEN 1 AND 5),
  INDEX idx_reviews_status (status)
);

CREATE TABLE IF NOT EXISTS client_activity (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  session_key VARCHAR(128),
  event_type ENUM('page_view','product_view','add_to_cart','remove_from_cart','checkout_started','order_placed','search') NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  ip_hash CHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_activity_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_activity_type_date (event_type,created_at),
  INDEX idx_activity_session (session_key)
);

CREATE TABLE IF NOT EXISTS store_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO categories (name,slug,description) VALUES
('Women','women','Women fashion'),
('Men','men','Men fashion'),
('Kids','kids','Kids fashion'),
('Accessories','accessories','Fashion accessories'),
('Cosmetics','cosmetics','Cosmetics and beauty');

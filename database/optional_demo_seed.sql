USE ashion_store;
-- Optional demo products. These use image placeholders until you upload real product photography.
INSERT IGNORE INTO products (category_id,name,slug,description,status,featured)
SELECT id,'Soft tailoring blazer','soft-tailoring-blazer','A clean, easy blazer for everyday styling.','active',1 FROM categories WHERE slug='women';
INSERT IGNORE INTO product_variants (product_id,size,color_name,color_hex,price,stock_quantity,sku)
SELECT id,'M','Butter yellow','#EBC75A',59,8,'ASH-BLAZER-M-YELLOW' FROM products WHERE slug='soft-tailoring-blazer';
INSERT IGNORE INTO product_variants (product_id,size,color_name,color_hex,price,stock_quantity,sku)
SELECT id,'L','Butter yellow','#EBC75A',62,5,'ASH-BLAZER-L-YELLOW' FROM products WHERE slug='soft-tailoring-blazer';

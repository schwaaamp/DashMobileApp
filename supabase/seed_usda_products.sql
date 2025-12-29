-- USDA Product Catalog Seed Data
-- Purpose: Pre-populate product_catalog with ~100 most common generic foods
-- Data source: USDA FoodData Central (generic/standard reference entries)
-- Note: This is a starter set - full 500-item seed can be generated via API script

-- Fruits (15 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('apple', 'Apple', NULL, 'food', 1, 'medium', 182, 95, 0.5, 25, 0.3, 4.4, 19, '{"vitamin_c": {"amount": 8.4, "unit": "mg"}}'),
('banana', 'Banana', NULL, 'food', 1, 'medium', 118, 105, 1.3, 27, 0.4, 3.1, 14, '{"potassium": {"amount": 422, "unit": "mg"}}'),
('orange', 'Orange', NULL, 'food', 1, 'medium', 131, 62, 1.2, 15, 0.2, 3.1, 12, '{"vitamin_c": {"amount": 69.7, "unit": "mg"}}'),
('strawberries', 'Strawberries', NULL, 'food', 1, 'cup', 144, 46, 1, 11, 0.4, 2.9, 7, '{"vitamin_c": {"amount": 84.7, "unit": "mg"}}'),
('blueberries', 'Blueberries', NULL, 'food', 1, 'cup', 148, 84, 1.1, 21, 0.5, 3.6, 15, '{"vitamin_k": {"amount": 28.6, "unit": "mcg"}}'),
('grapes', 'Grapes', NULL, 'food', 1, 'cup', 92, 62, 0.6, 16, 0.3, 0.8, 15, '{}'),
('watermelon', 'Watermelon', NULL, 'food', 1, 'cup', 152, 46, 0.9, 12, 0.2, 0.6, 9, '{"vitamin_c": {"amount": 12.3, "unit": "mg"}}'),
('avocado', 'Avocado', NULL, 'food', 0.5, 'medium', 100, 160, 2, 8.5, 15, 6.7, 0.7, '{"vitamin_e": {"amount": 2.1, "unit": "mg"}}'),
('pineapple', 'Pineapple', NULL, 'food', 1, 'cup', 165, 82, 0.9, 22, 0.2, 2.3, 16, '{"vitamin_c": {"amount": 78.9, "unit": "mg"}}'),
('mango', 'Mango', NULL, 'food', 1, 'cup', 165, 99, 1.4, 25, 0.6, 2.6, 23, '{"vitamin_a": {"amount": 1262, "unit": "IU"}}'),
('peach', 'Peach', NULL, 'food', 1, 'medium', 150, 59, 1.4, 14, 0.4, 2.3, 13, '{}'),
('pear', 'Pear', NULL, 'food', 1, 'medium', 178, 101, 0.6, 27, 0.2, 5.5, 17, '{}'),
('cherries', 'Cherries', NULL, 'food', 1, 'cup', 138, 87, 1.5, 22, 0.3, 2.9, 18, '{}'),
('cantaloupe', 'Cantaloupe', NULL, 'food', 1, 'cup', 160, 54, 1.3, 13, 0.3, 1.4, 12, '{"vitamin_a": {"amount": 5411, "unit": "IU"}}'),
('kiwi', 'Kiwi', NULL, 'food', 1, 'medium', 76, 42, 0.8, 10, 0.4, 2.1, 6, '{"vitamin_c": {"amount": 64, "unit": "mg"}}');

-- Vegetables (15 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('broccoli', 'Broccoli', NULL, 'food', 1, 'cup', 91, 31, 2.6, 6, 0.3, 2.4, 1.5, '{"vitamin_c": {"amount": 81.2, "unit": "mg"}, "vitamin_k": {"amount": 92.5, "unit": "mcg"}}'),
('spinach', 'Spinach', NULL, 'food', 1, 'cup', 30, 7, 0.9, 1.1, 0.1, 0.7, 0.1, '{"vitamin_k": {"amount": 145, "unit": "mcg"}, "iron": {"amount": 0.8, "unit": "mg"}}'),
('carrots', 'Carrots', NULL, 'food', 1, 'medium', 61, 25, 0.6, 6, 0.1, 1.7, 2.9, '{"vitamin_a": {"amount": 10191, "unit": "IU"}}'),
('tomato', 'Tomato', NULL, 'food', 1, 'medium', 123, 22, 1.1, 4.8, 0.2, 1.5, 3.2, '{"vitamin_c": {"amount": 16.9, "unit": "mg"}}'),
('cucumber', 'Cucumber', NULL, 'food', 0.5, 'medium', 150, 23, 1, 5.5, 0.2, 0.8, 2.9, '{}'),
('bell pepper', 'Bell Pepper', NULL, 'food', 1, 'medium', 119, 30, 1, 7, 0.3, 2.1, 4.2, '{"vitamin_c": {"amount": 152, "unit": "mg"}}'),
('lettuce', 'Lettuce', NULL, 'food', 1, 'cup', 55, 8, 0.6, 1.5, 0.1, 0.7, 0.6, '{}'),
('cauliflower', 'Cauliflower', NULL, 'food', 1, 'cup', 100, 25, 2, 5, 0.3, 2.1, 1.9, '{"vitamin_c": {"amount": 48.2, "unit": "mg"}}'),
('green beans', 'Green Beans', NULL, 'food', 1, 'cup', 100, 31, 1.8, 7, 0.2, 2.7, 3.3, '{}'),
('asparagus', 'Asparagus', NULL, 'food', 5, 'spears', 90, 18, 2, 3.9, 0.2, 1.8, 1.9, '{}'),
('sweet potato', 'Sweet Potato', NULL, 'food', 1, 'medium', 114, 103, 2.3, 24, 0.2, 3.8, 7.4, '{"vitamin_a": {"amount": 21909, "unit": "IU"}}'),
('white potato', 'Potato', NULL, 'food', 1, 'medium', 173, 164, 4.3, 37, 0.2, 2.4, 1.8, '{"potassium": {"amount": 926, "unit": "mg"}}'),
('onion', 'Onion', NULL, 'food', 0.5, 'medium', 70, 28, 0.8, 6.5, 0.1, 1.2, 3, '{}'),
('garlic', 'Garlic', NULL, 'food', 1, 'clove', 3, 4, 0.2, 1, 0, 0.1, 0, '{}'),
('mushrooms', 'Mushrooms', NULL, 'food', 1, 'cup', 70, 15, 2.2, 2.3, 0.2, 0.7, 1.4, '{"vitamin_d": {"amount": 0.2, "unit": "mcg"}}');

-- Proteins (15 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('chicken breast', 'Chicken Breast', NULL, 'food', 4, 'oz', 113, 165, 31, 0, 3.6, 0, 0, '{}'),
('ground beef', 'Ground Beef (85% lean)', NULL, 'food', 4, 'oz', 113, 215, 22, 0, 13, 0, 0, '{"iron": {"amount": 2.5, "unit": "mg"}}'),
('salmon', 'Salmon', NULL, 'food', 4, 'oz', 113, 206, 22, 0, 12, 0, 0, '{"omega_3": {"amount": 2000, "unit": "mg"}}'),
('eggs', 'Egg', NULL, 'food', 1, 'large', 50, 72, 6.3, 0.4, 4.8, 0, 0.2, '{"vitamin_b12": {"amount": 0.6, "unit": "mcg"}}'),
('tuna', 'Tuna (canned in water)', NULL, 'food', 3, 'oz', 85, 99, 22, 0, 0.7, 0, 0, '{}'),
('turkey breast', 'Turkey Breast', NULL, 'food', 4, 'oz', 113, 153, 33, 0, 1.7, 0, 0, '{}'),
('greek yogurt', 'Greek Yogurt (nonfat)', NULL, 'food', 1, 'container', 170, 100, 18, 7, 0, 0, 6, '{"calcium": {"amount": 150, "unit": "mg"}}'),
('cottage cheese', 'Cottage Cheese (lowfat)', NULL, 'food', 0.5, 'cup', 113, 92, 12, 5, 2.5, 0, 4, '{}'),
('tofu', 'Tofu (firm)', NULL, 'food', 3, 'oz', 85, 62, 7, 1.5, 3.5, 0.6, 0, '{"calcium": {"amount": 100, "unit": "mg"}, "iron": {"amount": 1.4, "unit": "mg"}}'),
('lentils', 'Lentils (cooked)', NULL, 'food', 1, 'cup', 198, 230, 18, 40, 0.8, 15.6, 3.6, '{"iron": {"amount": 6.6, "unit": "mg"}}'),
('black beans', 'Black Beans (cooked)', NULL, 'food', 1, 'cup', 172, 227, 15, 41, 0.9, 15, 0.6, '{}'),
('chickpeas', 'Chickpeas (cooked)', NULL, 'food', 1, 'cup', 164, 269, 15, 45, 4.2, 12.5, 7.9, '{}'),
('pork chop', 'Pork Chop', NULL, 'food', 4, 'oz', 113, 187, 26, 0, 8.5, 0, 0, '{}'),
('shrimp', 'Shrimp', NULL, 'food', 4, 'oz', 113, 112, 24, 0, 1.2, 0, 0, '{}'),
('almonds', 'Almonds', NULL, 'food', 1, 'oz', 28, 164, 6, 6, 14, 3.5, 1.2, '{"vitamin_e": {"amount": 7.3, "unit": "mg"}}');

-- Grains & Starches (10 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('brown rice', 'Brown Rice (cooked)', NULL, 'food', 1, 'cup', 195, 216, 5, 45, 1.8, 3.5, 0.7, '{}'),
('white rice', 'White Rice (cooked)', NULL, 'food', 1, 'cup', 158, 205, 4.2, 45, 0.4, 0.6, 0.1, '{}'),
('quinoa', 'Quinoa (cooked)', NULL, 'food', 1, 'cup', 185, 222, 8, 39, 3.6, 5.2, 1.6, '{"iron": {"amount": 2.8, "unit": "mg"}}'),
('oats', 'Oatmeal (cooked)', NULL, 'food', 1, 'cup', 234, 166, 5.9, 28, 3.6, 4, 0.6, '{}'),
('whole wheat bread', 'Whole Wheat Bread', NULL, 'food', 1, 'slice', 28, 69, 3.6, 12, 0.9, 1.9, 1.4, '{}'),
('white bread', 'White Bread', NULL, 'food', 1, 'slice', 25, 67, 2, 13, 0.8, 0.6, 1.2, '{}'),
('pasta', 'Pasta (cooked)', NULL, 'food', 1, 'cup', 140, 220, 8, 43, 1.3, 2.5, 0.8, '{}'),
('corn tortilla', 'Corn Tortilla', NULL, 'food', 1, 'tortilla', 24, 52, 1.4, 11, 0.7, 1.5, 0.3, '{}'),
('bagel', 'Bagel', NULL, 'food', 1, 'medium', 89, 245, 9.5, 48, 1.5, 1.9, 7.2, '{}'),
('crackers', 'Whole Wheat Crackers', NULL, 'food', 5, 'crackers', 15, 60, 1.5, 10, 2, 1.5, 0, '{}');

-- Dairy & Alternatives (10 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('milk', 'Milk (2%)', NULL, 'food', 1, 'cup', 244, 122, 8, 12, 4.8, 0, 12, '{"calcium": {"amount": 293, "unit": "mg"}}'),
('almond milk', 'Almond Milk (unsweetened)', NULL, 'food', 1, 'cup', 240, 37, 1.5, 1.5, 2.5, 0.5, 0, '{"calcium": {"amount": 451, "unit": "mg"}}'),
('soy milk', 'Soy Milk (unsweetened)', NULL, 'food', 1, 'cup', 240, 80, 7, 4, 4, 1, 1, '{}'),
('cheddar cheese', 'Cheddar Cheese', NULL, 'food', 1, 'oz', 28, 114, 7, 0.4, 9.4, 0, 0.1, '{"calcium": {"amount": 204, "unit": "mg"}}'),
('mozzarella cheese', 'Mozzarella Cheese (part skim)', NULL, 'food', 1, 'oz', 28, 72, 6.9, 0.8, 4.5, 0, 0.2, '{}'),
('butter', 'Butter', NULL, 'food', 1, 'tbsp', 14, 102, 0.1, 0, 11.5, 0, 0, '{}'),
('cream cheese', 'Cream Cheese', NULL, 'food', 1, 'tbsp', 14, 51, 0.9, 0.8, 5, 0, 0.5, '{}'),
('sour cream', 'Sour Cream', NULL, 'food', 2, 'tbsp', 24, 48, 0.6, 1.2, 4.7, 0, 0.6, '{}'),
('heavy cream', 'Heavy Cream', NULL, 'food', 1, 'tbsp', 15, 52, 0.3, 0.4, 5.5, 0, 0.4, '{}'),
('half and half', 'Half and Half', NULL, 'food', 1, 'tbsp', 15, 20, 0.4, 0.6, 1.7, 0, 0.5, '{}');

-- Oils & Condiments (10 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('olive oil', 'Olive Oil', NULL, 'food', 1, 'tbsp', 14, 119, 0, 0, 13.5, 0, 0, '{"vitamin_e": {"amount": 1.9, "unit": "mg"}}'),
('coconut oil', 'Coconut Oil', NULL, 'food', 1, 'tbsp', 14, 121, 0, 0, 13.5, 0, 0, '{}'),
('peanut butter', 'Peanut Butter', NULL, 'food', 2, 'tbsp', 32, 188, 8, 7, 16, 1.8, 3, '{}'),
('almond butter', 'Almond Butter', NULL, 'food', 2, 'tbsp', 32, 196, 6.7, 6, 18, 3.3, 2, '{}'),
('honey', 'Honey', NULL, 'food', 1, 'tbsp', 21, 64, 0.1, 17, 0, 0, 17, '{}'),
('maple syrup', 'Maple Syrup', NULL, 'food', 1, 'tbsp', 20, 52, 0, 13, 0, 0, 12, '{}'),
('ketchup', 'Ketchup', NULL, 'food', 1, 'tbsp', 17, 17, 0.2, 4.5, 0, 0.1, 3.7, '{}'),
('mustard', 'Mustard', NULL, 'food', 1, 'tsp', 5, 3, 0.2, 0.3, 0.2, 0.2, 0.1, '{}'),
('mayonnaise', 'Mayonnaise', NULL, 'food', 1, 'tbsp', 13, 94, 0.1, 0.1, 10, 0, 0.1, '{}'),
('soy sauce', 'Soy Sauce', NULL, 'food', 1, 'tbsp', 16, 8, 1.3, 0.8, 0, 0.1, 0.4, '{"sodium": {"amount": 879, "unit": "mg"}}');

-- Snacks & Common Packaged Foods (10 items)
INSERT INTO product_catalog (product_key, product_name, brand, product_type, serving_quantity, serving_unit, serving_weight_grams, calories, protein, carbs, fat, fiber, sugar, micros) VALUES
('protein bar', 'Protein Bar (generic)', NULL, 'food', 1, 'bar', 60, 200, 20, 22, 6, 3, 12, '{}'),
('granola bar', 'Granola Bar', NULL, 'food', 1, 'bar', 28, 120, 2, 18, 4, 1.5, 7, '{}'),
('energy bar', 'Energy Bar', NULL, 'food', 1, 'bar', 40, 180, 10, 24, 5, 3, 11, '{}'),
('dark chocolate', 'Dark Chocolate (70%)', NULL, 'food', 1, 'oz', 28, 170, 2, 13, 12, 3, 7, '{"iron": {"amount": 3.4, "unit": "mg"}}'),
('popcorn', 'Popcorn (air-popped)', NULL, 'food', 1, 'cup', 8, 31, 1, 6, 0.4, 1.2, 0.1, '{}'),
('pretzels', 'Pretzels', NULL, 'food', 1, 'oz', 28, 108, 2.6, 23, 0.8, 0.9, 0.9, '{}'),
('peanuts', 'Peanuts (roasted)', NULL, 'food', 1, 'oz', 28, 166, 6.9, 6, 14, 2.4, 1.4, '{}'),
('cashews', 'Cashews (roasted)', NULL, 'food', 1, 'oz', 28, 157, 5.2, 8.6, 12.4, 0.9, 1.7, '{}'),
('walnuts', 'Walnuts', NULL, 'food', 1, 'oz', 28, 185, 4.3, 3.9, 18.5, 1.9, 0.7, '{"omega_3": {"amount": 2570, "unit": "mg"}}'),
('hummus', 'Hummus', NULL, 'food', 2, 'tbsp', 28, 70, 2, 4, 5, 2, 0, '{}');

-- Note: Barcodes intentionally left NULL for generic USDA entries
-- User-submitted branded products will have barcodes filled in

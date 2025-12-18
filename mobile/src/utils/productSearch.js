/**
 * Product search utilities for food, supplements, and medications
 * Uses multiple data sources: Open Food Facts, USDA FoodData Central
 */

/**
 * Search Open Food Facts database (branded products, supplements)
 * Free API, no key required
 */
export async function searchOpenFoodFacts(query, limit = 10) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodedQuery}&search_simple=1&action=process&json=1&page_size=${limit}`;
    console.log(`Open Food Facts URL: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Open Food Facts error (${response.status}):`, errorText);
      throw new Error(`Open Food Facts API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Open Food Facts returned ${data.products?.length || 0} products`);

    if (!data.products || data.products.length === 0) {
      return [];
    }

    // Transform to our format
    return data.products.map(product => ({
      source: 'openfoodfacts',
      id: product.code,
      name: product.product_name || product.product_name_en,
      brand: product.brands,
      category: product.categories,
      servingSize: product.serving_size,
      nutrients: {
        calories: product.nutriments?.['energy-kcal_100g'],
        protein: product.nutriments?.proteins_100g,
        carbs: product.nutriments?.carbohydrates_100g,
        fat: product.nutriments?.fat_100g,
      },
      imageUrl: product.image_url,
      confidence: calculateMatchConfidence(query, product.product_name || product.product_name_en, product.brands),
    })).sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.error('Error searching Open Food Facts:', error);
    // Return empty array instead of throwing - don't let API errors block the flow
    return [];
  }
}

/**
 * Search USDA FoodData Central (generic foods)
 * Requires API key: https://fdc.nal.usda.gov/api-key-signup.html
 */
export async function searchUSDAFoodData(query, apiKey = process.env.EXPO_PUBLIC_USDA_API_KEY, limit = 10) {
  if (!apiKey || apiKey === 'your_usda_api_key_here') {
    console.log('USDA API key not configured, skipping USDA search');
    return [];
  }

  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=${limit}`
    );

    if (!response.ok) {
      throw new Error('USDA FoodData API error');
    }

    const data = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return [];
    }

    // Transform to our format
    return data.foods.map(food => {
      const nutrients = {};
      food.foodNutrients?.forEach(nutrient => {
        if (nutrient.nutrientName === 'Energy') {
          nutrients.calories = nutrient.value;
        } else if (nutrient.nutrientName === 'Protein') {
          nutrients.protein = nutrient.value;
        } else if (nutrient.nutrientName === 'Carbohydrate, by difference') {
          nutrients.carbs = nutrient.value;
        } else if (nutrient.nutrientName === 'Total lipid (fat)') {
          nutrients.fat = nutrient.value;
        }
      });

      return {
        source: 'usda',
        id: food.fdcId,
        name: food.description,
        brand: food.brandOwner,
        category: food.foodCategory,
        servingSize: food.servingSize ? `${food.servingSize} ${food.servingSizeUnit}` : null,
        nutrients,
        confidence: calculateMatchConfidence(query, food.description, food.brandOwner),
      };
    }).sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.error('Error searching USDA FoodData:', error);
    return [];
  }
}

/**
 * Calculate match confidence score (0-100)
 */
function calculateMatchConfidence(query, productName, brand) {
  if (!productName) return 0;

  const queryLower = query.toLowerCase();
  const nameLower = productName.toLowerCase();
  const brandLower = (brand || '').toLowerCase();

  let score = 0;

  // Exact match
  if (nameLower === queryLower) {
    score = 100;
  }
  // Name contains exact query
  else if (nameLower.includes(queryLower)) {
    score = 80;
  }
  // Query contains in name words
  else {
    const queryWords = queryLower.split(/\s+/);
    const nameWords = nameLower.split(/\s+/);
    const matchingWords = queryWords.filter(qw =>
      nameWords.some(nw => nw.includes(qw) || qw.includes(nw))
    );
    score = (matchingWords.length / queryWords.length) * 60;
  }

  // Boost for brand match
  if (brand && queryLower.includes(brandLower)) {
    score += 20;
  }

  // Boost for phonetic similarity (element -> lmnt)
  if (arePhoneticallyClose(queryLower, nameLower) ||
      (brand && arePhoneticallyClose(queryLower, brandLower))) {
    score += 15;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Check if two strings are phonetically close
 * Simple implementation - could be enhanced with Soundex or Metaphone
 */
function arePhoneticallyClose(str1, str2) {
  // Remove vowels and compare
  const consonants1 = str1.replace(/[aeiou]/g, '');
  const consonants2 = str2.replace(/[aeiou]/g, '');

  return consonants1.includes(consonants2) || consonants2.includes(consonants1);
}

/**
 * Create phonetic variations of the query
 * Helps find brand names that sound like common words (e.g., "element" -> "lmnt")
 * Returns multiple variations to increase chance of matching
 */
function createPhoneticVariations(query) {
  if (!query) return [];

  const words = query.toLowerCase().split(/\s+/);
  const variations = [];

  // For each word, create a vowel-removed version
  const phoneticWords = words.map(word => {
    // Remove all vowels from the word
    return word.replace(/[aeiou]/g, '');
  });

  // Create variations:
  // 1. Each individual word phonetically simplified (keeps other words original)
  words.forEach((word, index) => {
    if (phoneticWords[index] && phoneticWords[index] !== word) {
      const variation = [...words];
      variation[index] = phoneticWords[index];
      const varQuery = variation.join(' ');
      if (varQuery !== query.toLowerCase()) {
        variations.push(varQuery);
      }
    }
  });

  // 2. All words phonetically simplified (only if we have multiple words)
  if (words.length > 1) {
    const allPhonetic = phoneticWords.join(' ');
    if (allPhonetic !== query.toLowerCase() && !variations.includes(allPhonetic)) {
      variations.push(allPhonetic);
    }
  }

  return variations;
}

/**
 * Search all product databases
 */
export async function searchAllProducts(query, usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY) {
  console.log(`Searching products for: "${query}"`);

  const allSearches = [];

  // Search with original query
  allSearches.push(
    searchOpenFoodFacts(query, 12),
    searchUSDAFoodData(query, usdaApiKey, 12)
  );

  // Create phonetic variations (e.g., "element lemonade" -> ["lmnt lemonade", "element lmnd"])
  const phoneticVariations = createPhoneticVariations(query);

  for (const variation of phoneticVariations) {
    console.log(`Also searching variation: "${variation}"`);
    allSearches.push(
      searchOpenFoodFacts(variation, 8),
      searchUSDAFoodData(variation, usdaApiKey, 8)
    );
  }

  // Execute all searches in parallel
  const allResults = await Promise.all(allSearches);

  // Combine all results
  const allProducts = allResults.flat();

  // Remove duplicates based on name similarity
  const uniqueProducts = [];
  const seen = new Set();

  for (const product of allProducts) {
    const key = `${product.name}-${product.brand}`.toLowerCase().replace(/\s+/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProducts.push(product);
    }
  }

  // Sort by confidence
  uniqueProducts.sort((a, b) => b.confidence - a.confidence);

  console.log(`Found ${uniqueProducts.length} unique products`);

  // Return top 10
  return uniqueProducts.slice(0, 10);
}

/**
 * Determine if we should trigger product search
 */
export function shouldSearchProducts(eventType, eventData, confidence = 50) {
  // Only search for food, supplement, medication
  if (!['food', 'supplement', 'medication'].includes(eventType)) {
    return false;
  }

  // ALWAYS search for food, supplements, and medications to ensure accuracy
  // Even when Claude is confident, it might have transcribed incorrectly
  // (e.g., "element" instead of "LMNT")
  // The confirmation screen will show options for user to verify/select
  console.log(`Triggering product search for ${eventType} (confidence: ${confidence}%)`);
  return true;
}

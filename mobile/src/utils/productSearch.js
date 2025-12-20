/**
 * Product search utilities for food, supplements, and medications
 * Uses multiple data sources: Open Food Facts, USDA FoodData Central
 */

import { Logger } from './logger';
import Constants from 'expo-constants';

// Known supplement and food brands for detection
const KNOWN_BRANDS = [
  'lmnt', 'now', 'jarrow', 'thorne', 'pure encapsulations',
  'nature made', 'solgar', 'garden of life', 'optimum nutrition',
  'life extension', 'nordic naturals', 'carlson', 'doctors best',
  'vital proteins', 'ancestral supplements', 'seeking health',
  'designs for health', 'integrative therapeutics', 'klaire labs',
  'nutricost', 'bulk supplements', 'myprotein', 'orgain',
  'vega', 'amazing grass', 'sports research', 'zhou nutrition'
];

/**
 * Search Open Food Facts database (branded products, supplements)
 * Free API, no key required
 */
export async function searchOpenFoodFacts(query, limit = 10, userId = null) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodedQuery}&search_simple=1&action=process&json=1&page_size=${limit}`;
    console.log(`Open Food Facts URL: ${url}`);

    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;

    await Logger.apiCall(
      'OpenFoodFacts',
      '/cgi/search.pl',
      { query, limit },
      { status: response.status, ok: response.ok },
      duration,
      userId
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Open Food Facts error (${response.status}):`, errorText);
      throw new Error(`Open Food Facts API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Open Food Facts returned ${data.products?.length || 0} products`);

    await Logger.info('product_search', 'Open Food Facts search completed', {
      query,
      results_count: data.products?.length || 0,
      duration_ms: duration
    }, userId);

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
    await Logger.error('product_search', 'Open Food Facts search failed', {
      query,
      error_message: error.message,
      error_stack: error.stack
    }, userId);
    // Return empty array instead of throwing - don't let API errors block the flow
    return [];
  }
}

/**
 * Search USDA FoodData Central (generic foods)
 * Requires API key: https://fdc.nal.usda.gov/api-key-signup.html
 */
export async function searchUSDAFoodData(query, apiKey, limit = 10, userId = null) {
  // Get API key from environment if not provided
  // In Expo, EXPO_PUBLIC_ variables are available via Constants.expoConfig.extra
  const usdaKey = apiKey ||
                  Constants.expoConfig?.extra?.EXPO_PUBLIC_USDA_API_KEY ||
                  process.env.EXPO_PUBLIC_USDA_API_KEY;

  if (!usdaKey || usdaKey === 'your_usda_api_key_here') {
    console.log('USDA API key not configured, skipping USDA search');
    return [];
  }

  try {
    const startTime = Date.now();
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey}&query=${encodeURIComponent(query)}&pageSize=${limit}`
    );
    const duration = Date.now() - startTime;

    await Logger.apiCall(
      'USDA',
      '/fdc/v1/foods/search',
      { query, limit },
      { status: response.status, ok: response.ok },
      duration,
      userId
    );

    if (!response.ok) {
      throw new Error('USDA FoodData API error');
    }

    const data = await response.json();

    await Logger.info('product_search', 'USDA search completed', {
      query,
      results_count: data.foods?.length || 0,
      duration_ms: duration
    }, userId);

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
    await Logger.error('product_search', 'USDA search failed', {
      query,
      error_message: error.message,
      error_stack: error.stack
    }, userId);
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
export async function searchAllProducts(query, usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY, userId = null) {
  console.log(`Searching products for: "${query}"`);

  await Logger.info('product_search', 'Starting product search', {
    query,
    query_length: query.length
  }, userId);

  const allSearches = [];

  // Search with original query
  allSearches.push(
    searchOpenFoodFacts(query, 12, userId),
    searchUSDAFoodData(query, usdaApiKey, 12, userId)
  );

  // Create phonetic variations (e.g., "element lemonade" -> ["lmnt lemonade", "element lmnd"])
  const phoneticVariations = createPhoneticVariations(query);

  await Logger.info('product_search', 'Created phonetic variations', {
    original_query: query,
    variations: phoneticVariations,
    variations_count: phoneticVariations.length
  }, userId);

  for (const variation of phoneticVariations) {
    console.log(`Also searching variation: "${variation}"`);
    allSearches.push(
      searchOpenFoodFacts(variation, 8, userId),
      searchUSDAFoodData(variation, usdaApiKey, 8, userId)
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

  await Logger.info('product_search', 'Product search completed', {
    query,
    total_unique_products: uniqueProducts.length,
    top_10_results: uniqueProducts.slice(0, 10).map(p => ({
      name: p.name,
      brand: p.brand,
      confidence: p.confidence,
      source: p.source
    }))
  }, userId);

  // Return top 10
  return uniqueProducts.slice(0, 10);
}

/**
 * Detect if a description contains a known brand name
 */
function detectsKnownBrand(description) {
  if (!description) return false;
  const descLower = description.toLowerCase();
  return KNOWN_BRANDS.some(brand => descLower.includes(brand));
}

/**
 * Detect if Claude performed phonetic transformation on the input
 * e.g., "element" -> "lmnt", "citrus element" -> "citrus lmnt"
 */
function detectPhoneticTransformation(userInput, claudeOutput) {
  if (!userInput || !claudeOutput) return false;

  const inputWords = userInput.toLowerCase().split(/\s+/);
  const outputWords = claudeOutput.toLowerCase().split(/\s+/);

  // Check if Claude changed words phonetically
  for (const inputWord of inputWords) {
    const inputPhonetic = inputWord.replace(/[aeiou]/g, '');

    for (const outputWord of outputWords) {
      const outputPhonetic = outputWord.replace(/[aeiou]/g, '');

      // If phonetic forms match but original words don't, transformation detected
      if (inputPhonetic === outputPhonetic && inputWord !== outputWord) {
        console.log(`Phonetic transformation detected: "${inputWord}" -> "${outputWord}"`);
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine if we should trigger product search
 * Phase 1 Implementation: Intelligent conditional search
 *
 * @param {string} eventType - Type of event (food, supplement, medication, etc.)
 * @param {object} eventData - Parsed event data with description/name
 * @param {number} confidence - Claude's confidence score (0-100)
 * @param {string} userInput - Original user input text
 * @param {string} claudeOutput - Claude's parsed description/name
 * @returns {boolean} Whether to search product databases
 */
export function shouldSearchProducts(eventType, eventData, confidence = 50, userInput = '', claudeOutput = '') {
  // Only search for food, supplement, medication
  if (!['food', 'supplement', 'medication'].includes(eventType)) {
    return false;
  }

  const description = eventData?.description || eventData?.name || claudeOutput || '';

  // ALWAYS search for food (generic, needs product selection)
  if (eventType === 'food') {
    console.log(`Triggering product search for food (confidence: ${confidence}%)`);
    return true;
  }

  // SEARCH if confidence is below or at threshold
  if (confidence <= 83) {
    console.log(`Triggering product search - confidence (${confidence}%) at or below threshold`);
    return true;
  }

  // SEARCH if Claude performed phonetic transformation
  // This catches cases like "element" -> "LMNT" where we want to show options
  // Check this BEFORE brand detection to catch transformed brand names
  if (userInput && claudeOutput && description) {
    const hasTransformation = detectPhoneticTransformation(userInput, description);
    if (hasTransformation) {
      console.log(`Phonetic transformation detected: "${userInput}" -> "${description}"`);
      console.log(`Triggering product search - phonetic transformation detected`);
      return true;
    }
  }

  // SKIP search for very high confidence supplements/medications with brand names
  // Only if no transformation detected above
  if (eventType === 'supplement' || eventType === 'medication') {
    const hasBrandName = detectsKnownBrand(description);
    if (hasBrandName && confidence > 83) {
      console.log(`Skipping product search - high confidence (${confidence}%) ${eventType} with known brand`);
      return false;
    }
  }

  // Default: search for supplements/medications without known brands
  // This catches generic supplements like "Magnesium" or "Vitamin D" without brand
  console.log(`Triggering product search - ${eventType} without known brand (confidence: ${confidence}%)`);
  return true;
}

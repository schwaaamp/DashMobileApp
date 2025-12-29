/**
 * Medication Normalization via WHO ATC System
 *
 * Converts brand names to active ingredients using Gemini + local ATC table.
 * Handles multi-ingredient drugs (e.g., NyQuil = Acetaminophen + Dextromethorphan).
 *
 * Key Philosophy: "Universal Ingredient Language"
 * - US: Brand "Advil" → Ingredient "Ibuprofen 200mg" → ATC Code "M01AE01"
 * - UK: Brand "Nurofen" → Ingredient "Ibuprofen 200mg" → ATC Code "M01AE01"
 * - France: Brand "Doliprane" → Ingredient "Paracetamol 500mg" → ATC Code "N02BE01"
 *
 * This enables international medication tracking without maintaining brand databases.
 */

import { supabase } from './supabaseClient';

/**
 * Normalize brand name to active ingredient(s)
 *
 * Examples:
 * - "Advil" → [{name: "Ibuprofen", strength: "200mg", atc_code: "M01AE01"}]
 * - "NyQuil" → [{name: "Acetaminophen", ...}, {name: "Dextromethorphan", ...}]
 * - "Doliprane 500mg" → [{name: "Paracetamol", strength: "500mg", atc_code: "N02BE01"}]
 *
 * @param {string} brandName - User input (e.g., "Doliprane", "Advil")
 * @param {string} strength - Dosage (e.g., "500mg", "200mg") - optional
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<Array>} - [{name, strength, atc_code}, ...]
 */
export async function brandToIngredient(brandName, strength, geminiApiKey) {
  if (!brandName || !geminiApiKey) {
    return [];
  }

  try {
    // Step 1: Prompt Gemini to extract active ingredient(s)
    const prompt = `You are a pharmaceutical expert. Identify the active ingredient(s) in this medication.

Medication: "${brandName}"${strength ? ` ${strength}` : ''}

Rules:
1. Return ONLY the active ingredient name(s), not the brand name
2. For multi-ingredient drugs (e.g., NyQuil, Tylenol Cold), list ALL active ingredients
3. Use international non-proprietary names (INN) when possible
4. If strength is not provided, use the most common strength
5. Convert regional names to international standards:
   - US "Acetaminophen" → "Paracetamol" (INN)
   - Keep both if commonly used

Return JSON:
{
  "ingredients": [
    {
      "name": string,      // e.g., "Ibuprofen", "Paracetamol"
      "strength": string,  // e.g., "200mg", "500mg"
      "common_names": []   // e.g., ["Acetaminophen", "Paracetamol"]
    }
  ],
  "confidence": 0-100
}

Examples:
Input: "Advil"
Output: {"ingredients": [{"name": "Ibuprofen", "strength": "200mg", "common_names": ["Ibuprofen"]}], "confidence": 95}

Input: "NyQuil"
Output: {"ingredients": [
  {"name": "Paracetamol", "strength": "650mg", "common_names": ["Acetaminophen", "Paracetamol"]},
  {"name": "Dextromethorphan", "strength": "30mg", "common_names": ["Dextromethorphan HBr"]},
  {"name": "Doxylamine", "strength": "12.5mg", "common_names": ["Doxylamine Succinate"]}
], "confidence": 90}

Input: "Doliprane 500mg"
Output: {"ingredients": [{"name": "Paracetamol", "strength": "500mg", "common_names": ["Acetaminophen", "Paracetamol"]}], "confidence": 95}`;

    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('No content in Gemini response');
      return [];
    }

    const parsed = JSON.parse(content);

    if (!parsed.ingredients || parsed.ingredients.length === 0) {
      return [];
    }

    // Step 2: Look up ATC code(s) in local atc_codes table
    const enrichedIngredients = await Promise.all(
      parsed.ingredients.map(async (ingredient) => {
        const atcCode = await lookupATCCode(ingredient.name);

        return {
          name: ingredient.name,
          strength: ingredient.strength,
          atc_code: atcCode?.code || null,
          category: atcCode?.category || null,
          ddd: atcCode?.ddd || null,
          ddd_unit: atcCode?.ddd_unit || null,
          common_names: ingredient.common_names || []
        };
      })
    );

    return enrichedIngredients;

  } catch (error) {
    console.error('Error in brandToIngredient:', error);
    return [];
  }
}

/**
 * Look up ATC code by ingredient name
 *
 * Uses fuzzy matching to handle variations:
 * - "Ibuprofen" matches "Ibuprofen"
 * - "Acetaminophen" matches "Paracetamol (Acetaminophen)"
 * - Case-insensitive
 *
 * @param {string} ingredientName - e.g., "Ibuprofen", "Paracetamol"
 * @returns {Promise<Object|null>} - {code, name, category, ddd, ddd_unit}
 */
export async function lookupATCCode(ingredientName) {
  if (!ingredientName) return null;

  try {
    const normalized = ingredientName.trim().toLowerCase();

    // Try exact match first (case-insensitive)
    const { data: exactMatch, error: exactError } = await supabase
      .from('atc_codes')
      .select('*')
      .ilike('name', normalized)
      .limit(1)
      .single();

    if (!exactError && exactMatch) {
      return exactMatch;
    }

    // Try partial match (ingredient name contains or is contained in ATC name)
    const { data: fuzzyMatches, error: fuzzyError } = await supabase
      .from('atc_codes')
      .select('*')
      .or(`name.ilike.%${normalized}%,name.ilike.%${normalized.split(' ')[0]}%`)
      .limit(5);

    if (!fuzzyError && fuzzyMatches && fuzzyMatches.length > 0) {
      // Return best match (shortest name = most specific)
      const bestMatch = fuzzyMatches.reduce((best, current) =>
        current.name.length < best.name.length ? current : best
      );

      return bestMatch;
    }

    return null;

  } catch (error) {
    console.error('Error looking up ATC code:', error);
    return null;
  }
}

/**
 * Check if user is taking above WHO Defined Daily Dose (DDD)
 *
 * DDD = "assumed average maintenance dose per day for a drug used for its
 * main indication in adults" (WHO definition)
 *
 * @param {string} atcCode - e.g., "M01AE01" (Ibuprofen)
 * @param {number} userDoseMg - User's daily intake in mg
 * @returns {Promise<{isAboveDDD: boolean, ratio: number, ddd: number, ddd_unit: string}>}
 */
export async function checkAgainstDDD(atcCode, userDoseMg) {
  if (!atcCode || !userDoseMg) {
    return { isAboveDDD: false, ratio: 0, ddd: null, ddd_unit: null };
  }

  try {
    const { data, error } = await supabase
      .from('atc_codes')
      .select('ddd, ddd_unit, name')
      .eq('code', atcCode)
      .single();

    if (error || !data || !data.ddd) {
      return { isAboveDDD: false, ratio: 0, ddd: null, ddd_unit: null };
    }

    // Convert DDD to mg for comparison
    let dddMg = data.ddd;

    if (data.ddd_unit === 'g') {
      dddMg = data.ddd * 1000; // Convert grams to mg
    } else if (data.ddd_unit === 'mcg' || data.ddd_unit === 'μg') {
      dddMg = data.ddd / 1000; // Convert mcg to mg
    } else if (data.ddd_unit === 'U') {
      // Units (for insulin) - not directly comparable to mg
      return {
        isAboveDDD: userDoseMg > data.ddd,
        ratio: userDoseMg / data.ddd,
        ddd: data.ddd,
        ddd_unit: data.ddd_unit,
        medication: data.name
      };
    }
    // else assume mg

    const ratio = userDoseMg / dddMg;
    const isAboveDDD = ratio > 1.5; // Flag if 50% above standard dose

    return {
      isAboveDDD,
      ratio,
      ddd: data.ddd,
      ddd_unit: data.ddd_unit,
      medication: data.name
    };

  } catch (error) {
    console.error('Error checking against DDD:', error);
    return { isAboveDDD: false, ratio: 0, ddd: null, ddd_unit: null };
  }
}

/**
 * Normalize medication input for user registry
 *
 * Converts brand name + strength → standardized ingredient format
 * Used when adding medications to user_product_registry
 *
 * @param {string} userInput - e.g., "Advil 200mg", "Doliprane"
 * @param {string} geminiApiKey - Gemini API key
 * @returns {Promise<{normalized_name: string, ingredients: Array, is_multi_ingredient: boolean}>}
 */
export async function normalizeMedicationForRegistry(userInput, geminiApiKey) {
  const ingredients = await brandToIngredient(userInput, null, geminiApiKey);

  if (ingredients.length === 0) {
    // Fallback: use original input if normalization fails
    return {
      normalized_name: userInput,
      ingredients: [],
      is_multi_ingredient: false
    };
  }

  // For single-ingredient: "Ibuprofen 200mg"
  if (ingredients.length === 1) {
    const normalized_name = `${ingredients[0].name} ${ingredients[0].strength}`.trim();

    return {
      normalized_name,
      ingredients,
      is_multi_ingredient: false
    };
  }

  // For multi-ingredient: "Acetaminophen + Dextromethorphan (Cold & Flu)"
  const ingredientNames = ingredients.map(i => i.name).join(' + ');
  const normalized_name = `${ingredientNames} (combination)`;

  return {
    normalized_name,
    ingredients,
    is_multi_ingredient: true
  };
}

/**
 * Get medication info for display
 *
 * Enriches medication data with ATC classification and usage warnings
 *
 * @param {string} ingredientName - e.g., "Ibuprofen"
 * @param {number} dailyDoseMg - User's daily intake in mg
 * @returns {Promise<{name, atc_code, category, warning, safe_range}>}
 */
export async function getMedicationInfo(ingredientName, dailyDoseMg = null) {
  const atcInfo = await lookupATCCode(ingredientName);

  if (!atcInfo) {
    return {
      name: ingredientName,
      atc_code: null,
      category: 'Unknown',
      warning: null,
      safe_range: null
    };
  }

  let warning = null;
  let safe_range = null;

  if (dailyDoseMg && atcInfo.ddd) {
    const dddCheck = await checkAgainstDDD(atcInfo.code, dailyDoseMg);

    if (dddCheck.isAboveDDD) {
      warning = `⚠️ Daily dose (${dailyDoseMg}mg) is ${dddCheck.ratio.toFixed(1)}x the WHO standard (${atcInfo.ddd}${atcInfo.ddd_unit})`;
    }

    safe_range = `Standard daily dose: ${atcInfo.ddd}${atcInfo.ddd_unit}`;
  }

  return {
    name: atcInfo.name,
    atc_code: atcInfo.code,
    category: atcInfo.category,
    warning,
    safe_range
  };
}

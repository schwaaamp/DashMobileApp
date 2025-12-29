/**
 * Nutrient Calculation Utilities
 *
 * Calculates consumed nutrients based on serving size and amount consumed.
 */

/**
 * Calculate consumed nutrients based on amount taken vs serving size
 *
 * @param {Object} catalogProduct - Product from product_catalog with serving info
 * @param {number} catalogProduct.serving_quantity - Number of units per serving (e.g., 3)
 * @param {Object} catalogProduct.micros - Nutrients per serving {nutrient: {amount, unit}}
 * @param {number} amountConsumed - Number of units consumed (e.g., 1 capsule)
 * @returns {Object} Calculated nutrients with scaled amounts
 *
 * @example
 * // Magtein: 3 capsules per serving = 144mg magnesium
 * // User took 1 capsule
 * calculateConsumedNutrients(magteinProduct, 1)
 * // Returns: { magnesium: { amount: 48, unit: 'mg' } }
 */
export function calculateConsumedNutrients(catalogProduct, amountConsumed) {
  // Handle null/undefined micros
  if (!catalogProduct?.micros || typeof catalogProduct.micros !== 'object') {
    return {};
  }

  const { serving_quantity, micros } = catalogProduct;

  // Handle edge case of no serving quantity
  if (!serving_quantity || serving_quantity <= 0) {
    return {};
  }

  // Calculate ratio: how much of a serving did they consume?
  const ratio = amountConsumed / serving_quantity;

  const calculatedNutrients = {};

  for (const [nutrient, data] of Object.entries(micros)) {
    if (data && typeof data.amount === 'number') {
      // Calculate scaled amount and round to 1 decimal place
      const scaledAmount = Math.round((data.amount * ratio) * 10) / 10;

      calculatedNutrients[nutrient] = {
        amount: scaledAmount,
        unit: data.unit
      };
    }
  }

  return calculatedNutrients;
}

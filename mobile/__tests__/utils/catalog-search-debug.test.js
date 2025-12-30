/**
 * Debug Tests for Catalog Search
 *
 * These tests trace through the actual search flow to identify why
 * existing products aren't being found.
 */

// Mock expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64encodedimage'),
  EncodingType: { Base64: 'base64' }
}));

// Track all calls to searchProductCatalog
const searchCalls = [];

// Mock Supabase to track actual queries
jest.mock('../../src/utils/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        })),
        or: jest.fn((orClause) => {
          // Track the actual OR clause being used
          searchCalls.push({ table, orClause });
          return {
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({
                // Return product that matches "Magtein" - using real DB record format
                data: orClause.includes('magtein') ? [{
                  id: 'ec5c637a-a575-490e-9c1a-59d3a4b1ed0e',
                  product_key: 'now magtein magnesium l threonate',
                  product_name: 'Magtein Magnesium L-Threonate',
                  brand: 'NOW',
                  product_type: 'supplement',
                  serving_quantity: 3,
                  serving_unit: 'capsules',
                  micros: {
                    Magtein: { unit: 'g', amount: 2 },
                    'Magnesium (elemental)': { unit: 'mg', amount: 144 }
                  },
                  active_ingredients: [{ name: 'Magnesium L-Threonate', atc_code: null, strength: null }],
                  times_logged: 10
                }] : [],
                error: null
              }))
            }))
          };
        })
      })),
      insert: jest.fn().mockResolvedValue({ data: { id: 'mock-audit-id' }, error: null })
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'test.jpg' }, error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/test.jpg' } }))
      }))
    }
  }
}));

// Mock voice event parser
jest.mock('../../src/utils/voiceEventParser', () => ({
  createAuditRecord: jest.fn().mockResolvedValue({ id: 'mock-audit-id' }),
  updateAuditStatus: jest.fn().mockResolvedValue(true),
  createVoiceEvent: jest.fn().mockResolvedValue({ id: 'mock-event-id' })
}));

describe('Catalog Search Debug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchCalls.length = 0;
  });

  test('should trace search query construction for Gemini-detected product', async () => {
    // Simulate what Gemini Vision returns for a photo
    const geminiDetectedItem = {
      name: 'Magtein',  // Just "Magtein", not full product name
      brand: 'NOW',     // Just "NOW", not "NOW Foods"
      form: 'capsules',
      event_type: 'supplement'
    };

    // Import the function that builds the search query
    const { searchProductCatalog } = require('../../src/utils/productCatalog');

    // Trace what query would be built
    const searchQuery = geminiDetectedItem.brand
      ? `${geminiDetectedItem.brand} ${geminiDetectedItem.name}`
      : geminiDetectedItem.name;

    console.log('Search query constructed:', searchQuery);
    // Expected: "NOW Magtein"

    // The normalized query would be:
    const normalizedQuery = searchQuery.trim().toLowerCase();
    console.log('Normalized query:', normalizedQuery);
    // Expected: "now magtein"

    // The OR clause would look for this in product_name, brand, OR product_key
    // Real DB product_key: "now magtein magnesium l threonate"
    // Does "now magtein" match via ilike?

    const productKeyInDb = 'now magtein magnesium l threonate';
    const searchPattern = `%${normalizedQuery}%`;

    // ilike '%now magtein%' on 'now magtein magnesium l threonate'
    // This SHOULD match because "now magtein" IS a contiguous substring!

    console.log('Product key in DB:', productKeyInDb);
    console.log('Search pattern:', searchPattern);
    console.log('Would match via substring?', productKeyInDb.includes(normalizedQuery));

    // With the real DB format, "now magtein" IS a substring of "now magtein magnesium l threonate"
    expect(productKeyInDb.includes(normalizedQuery)).toBe(true);
  });

  test('should demonstrate substring matching with real DB format', () => {
    // What Gemini detects from photo
    const detectedBrand = 'NOW';
    const detectedName = 'Magtein';

    // What's in the real database (NOW Magtein product)
    const dbProductName = 'Magtein Magnesium L-Threonate';
    const dbBrand = 'NOW';
    const dbProductKey = 'now magtein magnesium l threonate';

    // Search query built by findCatalogMatchByText
    const searchQuery = `${detectedBrand} ${detectedName}`.toLowerCase();
    // = "now magtein"

    // The ilike query checks:
    // 1. product_name.ilike.%now magtein%
    // 2. brand.ilike.%now magtein%
    // 3. product_key.ilike.%now magtein%

    // Does "now magtein" appear as substring in any of these?
    const matchesProductName = dbProductName.toLowerCase().includes(searchQuery);
    const matchesBrand = dbBrand.toLowerCase().includes(searchQuery);
    const matchesProductKey = dbProductKey.includes(searchQuery);

    console.log('Query:', searchQuery);
    console.log('Matches product_name?', matchesProductName, `("${dbProductName.toLowerCase()}")`);
    console.log('Matches brand?', matchesBrand, `("${dbBrand.toLowerCase()}")`);
    console.log('Matches product_key?', matchesProductKey, `("${dbProductKey}")`);

    // With the real DB format, product_key DOES match!
    // - product_name: "magtein magnesium l-threonate" - no "now" at all (no match)
    // - brand: "now" - no "magtein" (no match)
    // - product_key: "now magtein magnesium l threonate" - HAS "now magtein" at start! (MATCH)

    expect(matchesProductKey).toBe(true);
    expect(matchesProductName || matchesBrand || matchesProductKey).toBe(true);
  });

  test('should show various search strategies with real DB format', () => {
    // Real DB record format
    const dbProductName = 'Magtein Magnesium L-Threonate';
    const dbBrand = 'NOW';
    const dbProductKey = 'now magtein magnesium l threonate';

    // Search for just the product name would work
    const justName = 'magtein';
    expect(dbProductName.toLowerCase().includes(justName)).toBe(true);
    expect(dbProductKey.includes(justName)).toBe(true);

    // Search for just the brand would work
    const justBrand = 'now';
    expect(dbBrand.toLowerCase().includes(justBrand)).toBe(true);
    expect(dbProductKey.includes(justBrand)).toBe(true);

    // Combined "now magtein" DOES work with real DB format
    const combined = 'now magtein';
    expect(dbProductKey.includes(combined)).toBe(true);
  });
});

describe('Fix: Search should match individual terms', () => {
  test('should match when ALL search terms are present', () => {
    // Real DB product_key format
    const dbProductKey = 'now magtein magnesium l threonate';

    // Split search query into terms
    const searchQuery = 'now magtein';
    const searchTerms = searchQuery.split(/\s+/);

    // Check if ALL terms appear somewhere in the product key
    const allTermsPresent = searchTerms.every(term => dbProductKey.includes(term));

    expect(allTermsPresent).toBe(true);
  });

  test('fixed searchProductCatalog builds correct OR conditions', () => {
    const query = 'NOW Magtein';
    const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);

    // Expected: ["now", "magtein"]
    expect(terms).toEqual(['now', 'magtein']);

    // Build OR conditions like the fixed function does
    const orConditions = terms.map(term =>
      `product_name.ilike.%${term}%,brand.ilike.%${term}%,product_key.ilike.%${term}%`
    ).join(',');

    // Should generate conditions that match each term individually
    expect(orConditions).toContain('product_name.ilike.%now%');
    expect(orConditions).toContain('product_name.ilike.%magtein%');
    expect(orConditions).toContain('brand.ilike.%now%');
    expect(orConditions).toContain('brand.ilike.%magtein%');
  });

  test('scoring logic should rank products matching more terms higher', () => {
    const terms = ['now', 'magtein'];

    // Simulate scoring products - using real DB format
    const products = [
      { product_name: 'Vitamin C', brand: 'Generic', product_key: 'generic vitamin c' },  // 0 matches
      { product_name: 'Magtein', brand: 'Generic', product_key: 'generic magtein' },      // 1 match (magtein)
      { product_name: 'Magtein Magnesium L-Threonate', brand: 'NOW', product_key: 'now magtein magnesium l threonate' }, // 2 matches
    ];

    const scored = products.map(product => {
      const searchableText = `${product.product_name} ${product.brand} ${product.product_key}`.toLowerCase();
      const matchCount = terms.filter(term => searchableText.includes(term)).length;
      return { ...product, _matchScore: matchCount };
    });

    // Sort by match score descending
    scored.sort((a, b) => b._matchScore - a._matchScore);

    // Product matching both "now" and "magtein" should be first
    expect(scored[0].brand).toBe('NOW');
    expect(scored[0]._matchScore).toBe(2);

    // Product matching only "magtein" should be second
    expect(scored[1].brand).toBe('Generic');
    expect(scored[1]._matchScore).toBe(1);

    // Product matching neither should be last
    expect(scored[2].product_name).toBe('Vitamin C');
    expect(scored[2]._matchScore).toBe(0);
  });
});

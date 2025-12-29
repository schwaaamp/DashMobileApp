/**
 * Medication Normalizer Tests
 *
 * Tests for brand → ingredient conversion using WHO ATC system
 */

import {
  brandToIngredient,
  lookupATCCode,
  checkAgainstDDD,
  normalizeMedicationForRegistry,
  getMedicationInfo
} from '@/utils/medicationNormalizer';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('@/utils/supabaseClient');

describe('Medication Normalizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock for global fetch (Gemini API)
    global.fetch = jest.fn();
  });

  describe('brandToIngredient', () => {
    it('should normalize US brand to active ingredient', async () => {
      // Mock Gemini response
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [{
                      name: 'Ibuprofen',
                      strength: '200mg',
                      common_names: ['Ibuprofen']
                    }],
                    confidence: 95
                  })
                }]
              }
            }]
          })
        })
      );

      // Mock ATC lookup
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  code: 'M01AE01',
                  name: 'Ibuprofen',
                  category: 'Musculo-skeletal system / Anti-inflammatory',
                  ddd: 1.2,
                  ddd_unit: 'g'
                },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await brandToIngredient('Advil', '200mg', 'test-api-key');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Ibuprofen');
      expect(result[0].strength).toBe('200mg');
      expect(result[0].atc_code).toBe('M01AE01');
    });

    it('should normalize UK brand to same active ingredient', async () => {
      // Mock Gemini response for UK brand "Nurofen"
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [{
                      name: 'Ibuprofen',
                      strength: '200mg',
                      common_names: ['Ibuprofen']
                    }],
                    confidence: 95
                  })
                }]
              }
            }]
          })
        })
      );

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  code: 'M01AE01',
                  name: 'Ibuprofen',
                  category: 'Musculo-skeletal system',
                  ddd: 1.2,
                  ddd_unit: 'g'
                },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await brandToIngredient('Nurofen', '200mg', 'test-api-key');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Ibuprofen');
      expect(result[0].atc_code).toBe('M01AE01'); // Same ATC code as Advil
    });

    it('should handle multi-ingredient drugs (combo medications)', async () => {
      // Mock Gemini response for NyQuil (3 active ingredients)
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [
                      {
                        name: 'Paracetamol',
                        strength: '650mg',
                        common_names: ['Acetaminophen', 'Paracetamol']
                      },
                      {
                        name: 'Dextromethorphan',
                        strength: '30mg',
                        common_names: ['Dextromethorphan HBr']
                      },
                      {
                        name: 'Doxylamine',
                        strength: '12.5mg',
                        common_names: ['Doxylamine Succinate']
                      }
                    ],
                    confidence: 90
                  })
                }]
              }
            }]
          })
        })
      );

      // Mock ATC lookups for each ingredient
      let callCount = 0;
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => {
                const responses = [
                  { data: { code: 'N02BE01', name: 'Paracetamol' }, error: null },
                  { data: { code: 'R05DA09', name: 'Dextromethorphan' }, error: null },
                  { data: null, error: { code: 'PGRST116' } } // Doxylamine not in DB
                ];
                return Promise.resolve(responses[callCount++]);
              })
            }))
          }))
        }))
      }));

      const result = await brandToIngredient('NyQuil', null, 'test-api-key');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Paracetamol');
      expect(result[0].atc_code).toBe('N02BE01');
      expect(result[1].name).toBe('Dextromethorphan');
      expect(result[1].atc_code).toBe('R05DA09');
      expect(result[2].name).toBe('Doxylamine');
      expect(result[2].atc_code).toBeNull(); // Not in ATC database
    });

    it('should handle unknown brands gracefully', async () => {
      // Mock Gemini returning empty ingredients
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [],
                    confidence: 0
                  })
                }]
              }
            }]
          })
        })
      );

      const result = await brandToIngredient('FakeProduct123', null, 'test-api-key');

      expect(result).toEqual([]);
    });

    it('should handle French brand "Doliprane" (Paracetamol)', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [{
                      name: 'Paracetamol',
                      strength: '500mg',
                      common_names: ['Acetaminophen', 'Paracetamol']
                    }],
                    confidence: 95
                  })
                }]
              }
            }]
          })
        })
      );

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  code: 'N02BE01',
                  name: 'Paracetamol (Acetaminophen)',
                  ddd: 3,
                  ddd_unit: 'g'
                },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await brandToIngredient('Doliprane', '500mg', 'test-api-key');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Paracetamol');
      expect(result[0].atc_code).toBe('N02BE01');
      expect(result[0].common_names).toContain('Acetaminophen');
    });

    it('should handle Gemini API errors', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500
        })
      );

      const result = await brandToIngredient('Advil', null, 'test-api-key');

      expect(result).toEqual([]);
    });
  });

  describe('lookupATCCode', () => {
    it('should find ATC code for exact ingredient name', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  code: 'M01AE01',
                  name: 'Ibuprofen',
                  category: 'Musculo-skeletal system',
                  ddd: 1.2,
                  ddd_unit: 'g'
                },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await lookupATCCode('Ibuprofen');

      expect(result).toBeDefined();
      expect(result.code).toBe('M01AE01');
      expect(result.name).toBe('Ibuprofen');
    });

    it('should handle case-insensitive search', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: {
                  code: 'M01AE01',
                  name: 'Ibuprofen',
                  ddd: 1.2,
                  ddd_unit: 'g'
                },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await lookupATCCode('ibuprofen'); // lowercase

      expect(result).toBeDefined();
      expect(result.code).toBe('M01AE01');
    });

    it('should return null for unknown ingredients', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: null,
                error: { code: 'PGRST116' }
              }))
            }))
          }))
        }))
      }));

      const result = await lookupATCCode('NotARealDrug');

      expect(result).toBeNull();
    });

    it('should use fuzzy matching as fallback', async () => {
      // Mock exact match failing, fuzzy match succeeding
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn((count) => {
              if (count === 1) {
                // Exact match fails
                return {
                  single: jest.fn(() => Promise.resolve({
                    data: null,
                    error: { code: 'PGRST116' }
                  }))
                };
              }
              // Fuzzy match succeeds
              return Promise.resolve({
                data: [
                  { code: 'N02BE01', name: 'Paracetamol (Acetaminophen)', ddd: 3, ddd_unit: 'g' }
                ],
                error: null
              });
            })
          })),
          or: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve({
              data: [
                { code: 'N02BE01', name: 'Paracetamol (Acetaminophen)', ddd: 3, ddd_unit: 'g' }
              ],
              error: null
            }))
          }))
        }))
      }));

      const result = await lookupATCCode('Acetaminophen');

      expect(result).toBeDefined();
      expect(result.code).toBe('N02BE01');
    });
  });

  describe('checkAgainstDDD', () => {
    it('should flag when user exceeds WHO Defined Daily Dose', async () => {
      // Ibuprofen DDD = 1.2g = 1200mg
      // User taking 2400mg = 2x DDD
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                code: 'M01AE01',
                name: 'Ibuprofen',
                ddd: 1.2,
                ddd_unit: 'g'
              },
              error: null
            }))
          }))
        }))
      }));

      const result = await checkAgainstDDD('M01AE01', 2400);

      expect(result.isAboveDDD).toBe(true);
      expect(result.ratio).toBe(2.0);
      expect(result.medication).toBe('Ibuprofen');
    });

    it('should return normal for doses within DDD range', async () => {
      // Ibuprofen DDD = 1.2g = 1200mg
      // User taking 800mg = 0.67x DDD
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                code: 'M01AE01',
                name: 'Ibuprofen',
                ddd: 1.2,
                ddd_unit: 'g'
              },
              error: null
            }))
          }))
        }))
      }));

      const result = await checkAgainstDDD('M01AE01', 800);

      expect(result.isAboveDDD).toBe(false);
      expect(result.ratio).toBeCloseTo(0.67, 1);
    });

    it('should handle insulin (units, not mg)', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                code: 'A10AB01',
                name: 'Insulin (human)',
                ddd: 40,
                ddd_unit: 'U'
              },
              error: null
            }))
          }))
        }))
      }));

      const result = await checkAgainstDDD('A10AB01', 50);

      expect(result.ratio).toBe(1.25);
      expect(result.ddd_unit).toBe('U');
    });

    it('should handle medications without DDD', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: {
                code: 'N05BA01',
                name: 'Diazepam',
                ddd: null,
                ddd_unit: null
              },
              error: null
            }))
          }))
        }))
      }));

      const result = await checkAgainstDDD('N05BA01', 10);

      expect(result.isAboveDDD).toBe(false);
      expect(result.ddd).toBeNull();
    });
  });

  describe('normalizeMedicationForRegistry', () => {
    it('should normalize single-ingredient medication', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [{
                      name: 'Ibuprofen',
                      strength: '200mg',
                      common_names: ['Ibuprofen']
                    }],
                    confidence: 95
                  })
                }]
              }
            }]
          })
        })
      );

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: { code: 'M01AE01', name: 'Ibuprofen' },
                error: null
              }))
            }))
          }))
        }))
      }));

      const result = await normalizeMedicationForRegistry('Advil 200mg', 'test-api-key');

      expect(result.normalized_name).toBe('Ibuprofen 200mg');
      expect(result.is_multi_ingredient).toBe(false);
      expect(result.ingredients).toHaveLength(1);
    });

    it('should normalize multi-ingredient medication', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    ingredients: [
                      { name: 'Paracetamol', strength: '650mg', common_names: [] },
                      { name: 'Dextromethorphan', strength: '30mg', common_names: [] }
                    ],
                    confidence: 90
                  })
                }]
              }
            }]
          })
        })
      );

      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } }))
            }))
          }))
        }))
      }));

      const result = await normalizeMedicationForRegistry('NyQuil', 'test-api-key');

      expect(result.normalized_name).toBe('Paracetamol + Dextromethorphan (combination)');
      expect(result.is_multi_ingredient).toBe(true);
      expect(result.ingredients).toHaveLength(2);
    });

    it('should fallback to original input if normalization fails', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500
        })
      );

      const result = await normalizeMedicationForRegistry('UnknownDrug', 'test-api-key');

      expect(result.normalized_name).toBe('UnknownDrug');
      expect(result.ingredients).toEqual([]);
      expect(result.is_multi_ingredient).toBe(false);
    });
  });

  describe('getMedicationInfo', () => {
    it('should return medication info with DDD warning', async () => {
      supabase.from = jest.fn((table) => {
        if (table === 'atc_codes') {
          return {
            select: jest.fn(() => ({
              ilike: jest.fn(() => ({
                limit: jest.fn(() => ({
                  single: jest.fn(() => Promise.resolve({
                    data: {
                      code: 'M01AE01',
                      name: 'Ibuprofen',
                      category: 'Musculo-skeletal / NSAIDs',
                      ddd: 1.2,
                      ddd_unit: 'g'
                    },
                    error: null
                  }))
                }))
              })),
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    code: 'M01AE01',
                    name: 'Ibuprofen',
                    ddd: 1.2,
                    ddd_unit: 'g'
                  },
                  error: null
                }))
              }))
            }))
          };
        }
        return {};
      });

      const result = await getMedicationInfo('Ibuprofen', 2400);

      expect(result.name).toBe('Ibuprofen');
      expect(result.atc_code).toBe('M01AE01');
      expect(result.warning).toContain('2.0x');
      expect(result.safe_range).toBe('Standard daily dose: 1.2g');
    });

    it('should handle unknown medications', async () => {
      supabase.from = jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: null,
                error: { code: 'PGRST116' }
              }))
            }))
          }))
        }))
      }));

      const result = await getMedicationInfo('UnknownDrug');

      expect(result.name).toBe('UnknownDrug');
      expect(result.atc_code).toBeNull();
      expect(result.category).toBe('Unknown');
      expect(result.warning).toBeNull();
    });
  });
});

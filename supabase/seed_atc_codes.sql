-- WHO ATC Codes Seed Data
-- Purpose: Pre-populate atc_codes table with most common medications
-- Data source: WHO Anatomical Therapeutic Chemical classification system
-- Note: This is a starter set of ~50 common medications - can be expanded to 500+

-- N - Nervous System (Pain relievers, mental health, etc.)
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('N02BE01', 'Paracetamol (Acetaminophen)', 'Nervous system / Analgesics / Other analgesics and antipyretics', 3, 'g'),
('M01AE01', 'Ibuprofen', 'Musculo-skeletal system / Anti-inflammatory and antirheumatic products', 1.2, 'g'),
('M01AE02', 'Naproxen', 'Musculo-skeletal system / NSAIDs', 0.5, 'g'),
('N02AA59', 'Codeine (combinations)', 'Nervous system / Opioids', 0.1, 'g'),
('N05BA01', 'Diazepam', 'Nervous system / Anxiolytics / Benzodiazepines', 10, 'mg'),
('N06AB04', 'Citalopram', 'Nervous system / Antidepressants / SSRIs', 20, 'mg'),
('N06AB06', 'Sertraline', 'Nervous system / Antidepressants / SSRIs', 50, 'mg'),
('N06AB10', 'Escitalopram', 'Nervous system / Antidepressants / SSRIs', 10, 'mg'),
('N06AB03', 'Fluoxetine', 'Nervous system / Antidepressants / SSRIs', 20, 'mg'),
('N05AN01', 'Lithium', 'Nervous system / Antipsychotics', 24, 'mmol'),
('N06AX21', 'Duloxetine', 'Nervous system / Antidepressants / SNRIs', 60, 'mg'),
('N06AX16', 'Venlafaxine', 'Nervous system / Antidepressants / SNRIs', 0.1, 'g'),
('N05AH04', 'Quetiapine', 'Nervous system / Antipsychotics', 0.4, 'g'),
('N03AX09', 'Lamotrigine', 'Nervous system / Antiepileptics', 0.3, 'g'),
('N05AX08', 'Risperidone', 'Nervous system / Antipsychotics', 5, 'mg'),
('N06DA02', 'Donepezil', 'Nervous system / Anti-dementia drugs', 5, 'mg');

-- C - Cardiovascular System
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('C09AA02', 'Enalapril', 'Cardiovascular system / ACE inhibitors', 10, 'mg'),
('C09AA03', 'Lisinopril', 'Cardiovascular system / ACE inhibitors', 10, 'mg'),
('C09CA01', 'Losartan', 'Cardiovascular system / ARBs', 50, 'mg'),
('C09CA06', 'Candesartan', 'Cardiovascular system / ARBs', 8, 'mg'),
('C10AA01', 'Simvastatin', 'Cardiovascular system / Statins / Lipid modifying agents', 15, 'mg'),
('C10AA05', 'Atorvastatin', 'Cardiovascular system / Statins', 15, 'mg'),
('C10AA07', 'Rosuvastatin', 'Cardiovascular system / Statins', 10, 'mg'),
('C07AB02', 'Metoprolol', 'Cardiovascular system / Beta blockers', 0.15, 'g'),
('C07AB07', 'Bisoprolol', 'Cardiovascular system / Beta blockers', 10, 'mg'),
('C07AB03', 'Atenolol', 'Cardiovascular system / Beta blockers', 75, 'mg'),
('C08CA01', 'Amlodipine', 'Cardiovascular system / Calcium channel blockers', 5, 'mg'),
('C03CA01', 'Furosemide', 'Cardiovascular system / Diuretics', 40, 'mg'),
('C03AA03', 'Hydrochlorothiazide', 'Cardiovascular system / Diuretics', 25, 'mg'),
('B01AC06', 'Acetylsalicylic acid (Aspirin)', 'Blood and blood forming organs / Antithrombotic agents', 0.15, 'g'),
('B01AC04', 'Clopidogrel', 'Blood and blood forming organs / Platelet aggregation inhibitors', 75, 'mg');

-- A - Alimentary Tract and Metabolism (Diabetes, GI drugs)
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('A10BA02', 'Metformin', 'Alimentary tract and metabolism / Blood glucose lowering drugs', 2, 'g'),
('A10BH01', 'Sitagliptin', 'Alimentary tract and metabolism / DPP-4 inhibitors', 0.1, 'g'),
('A10BX07', 'Canagliflozin', 'Alimentary tract and metabolism / SGLT2 inhibitors', 0.2, 'g'),
('A10AB01', 'Insulin (human)', 'Alimentary tract and metabolism / Insulins', 40, 'U'),
('A10AB04', 'Insulin lispro', 'Alimentary tract and metabolism / Fast-acting insulin', 40, 'U'),
('A10AE04', 'Insulin glargine', 'Alimentary tract and metabolism / Long-acting insulin', 40, 'U'),
('A02BC01', 'Omeprazole', 'Alimentary tract and metabolism / Proton pump inhibitors', 20, 'mg'),
('A02BC02', 'Pantoprazole', 'Alimentary tract and metabolism / PPIs', 40, 'mg'),
('A02BC05', 'Esomeprazole', 'Alimentary tract and metabolism / PPIs', 30, 'mg'),
('A02BA02', 'Ranitidine', 'Alimentary tract and metabolism / H2-receptor antagonists', 0.3, 'g'),
('A07DA03', 'Loperamide', 'Alimentary tract and metabolism / Antidiarrheals', 8, 'mg');

-- J - Anti-infectives for Systemic Use (Antibiotics)
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('J01CA04', 'Amoxicillin', 'Anti-infectives for systemic use / Penicillins', 1, 'g'),
('J01CR02', 'Amoxicillin and clavulanic acid', 'Anti-infectives / Beta-lactam antibacterials, penicillins', 1, 'g'),
('J01DD04', 'Ceftriaxone', 'Anti-infectives / Third-generation cephalosporins', 2, 'g'),
('J01FA10', 'Azithromycin', 'Anti-infectives / Macrolides', 0.3, 'g'),
('J01MA02', 'Ciprofloxacin', 'Anti-infectives / Fluoroquinolones', 0.5, 'g'),
('J01XD01', 'Metronidazole', 'Anti-infectives / Imidazole derivatives', 2, 'g'),
('J01AA02', 'Doxycycline', 'Anti-infectives / Tetracyclines', 0.1, 'g'),
('J02AC01', 'Fluconazole', 'Anti-infectives for systemic use / Antifungals', 0.2, 'g');

-- R - Respiratory System
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('R03AC02', 'Salbutamol (Albuterol)', 'Respiratory system / Beta2 agonists / Adrenergics, inhalants', 0.8, 'mg'),
('R03BA01', 'Beclometasone', 'Respiratory system / Glucocorticoids', 0.8, 'mg'),
('R03BA05', 'Fluticasone', 'Respiratory system / Glucocorticoids', 0.6, 'mg'),
('R03AK06', 'Salmeterol and fluticasone', 'Respiratory system / Adrenergics in combination with corticosteroids', NULL, NULL),
('R03DA04', 'Theophylline', 'Respiratory system / Xanthines', 0.4, 'g'),
('R05DA09', 'Dextromethorphan', 'Respiratory system / Cough suppressants', 60, 'mg'),
('R06AX27', 'Desloratadine', 'Respiratory system / Antihistamines', 5, 'mg'),
('R06AE07', 'Cetirizine', 'Respiratory system / Antihistamines', 10, 'mg'),
('R06AX13', 'Loratadine', 'Respiratory system / Antihistamines', 10, 'mg');

-- H - Systemic Hormonal Preparations (Thyroid, contraceptives)
INSERT INTO atc_codes (code, name, category, ddd, ddd_unit) VALUES
('H03AA01', 'Levothyroxine sodium', 'Systemic hormonal preparations / Thyroid therapy', 0.15, 'mg'),
('G03AA09', 'Desogestrel', 'Genito urinary system and sex hormones / Progestogens and estrogens', NULL, NULL),
('G03CA03', 'Estradiol', 'Genito urinary system / Estrogens', 2, 'mg');

-- Note: DDD values are for reference only - actual therapeutic doses vary by indication and patient
-- Some combination drugs have NULL DDD as they're not separately defined by WHO

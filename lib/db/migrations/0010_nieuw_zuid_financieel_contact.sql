-- Financiële contactpersoon van Bouwcombinatie Nieuw-Zuid voor de indexatiemails (uit de mailwisseling 2024-2025:
-- Johan Huizer, Finance Manager, Mobilis/Nieuw-Zuid; Justin mailt hem de indexatie-aanvraag en hij laat de bon opmaken).
-- Zonder dit contact valt het systeem terug op de laatste afzender uit eerdere mails (nu Han de Jong, de planner).
-- Alleen als de klant bestaat en dit adres er nog niet bij staat; te verwijderen via Klanten.
INSERT INTO "contactpersonen" ("klant_id", "naam", "email", "rol")
SELECT k."id", 'Johan Huizer', 'j.huizer@mobilis.nl', 'Finance Manager (indexatie)'
FROM "klanten" k
WHERE k."naam" ILIKE '%nieuw%zuid%'
  AND NOT EXISTS (
    SELECT 1 FROM "contactpersonen" c WHERE c."klant_id" = k."id" AND lower(c."email") = 'j.huizer@mobilis.nl'
  );

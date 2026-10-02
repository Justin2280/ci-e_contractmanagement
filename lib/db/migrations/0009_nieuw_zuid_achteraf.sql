-- Herstel van de indexatie-afspraken van Bouwcombinatie Nieuw-Zuid (contract 21116-037C).
-- Uit de mailwisseling 2023-2025: de indexatie loopt achteraf. Het CBS-cijfer (index 71121, sinds 2024 7112)
-- van het 1e kwartaal van het lopende jaar wordt in september/oktober uitgevraagd en met terugwerkende kracht
-- per 1 januari doorgevoerd via een correctiebon over de uren t/m week 40; het nieuwe tarief geldt vanaf week 41.
-- Een eerdere beoordeling had de wijze op de standaard ("vooraf") en het kwartaal op "uit clausule" teruggezet.
-- Alleen waar nog de standaard staat; een bewust gekozen instelling blijft ongemoeid.
UPDATE "contracten"
SET "indexatie_wijze" = 'achteraf_correctie'
WHERE "nummer" = '21116-037C' AND "indexatie" = 'jaarlijks_cbs' AND "indexatie_wijze" = 'vooraf';
--> statement-breakpoint
UPDATE "contracten"
SET "indexatie_kwartaal" = 1
WHERE "nummer" = '21116-037C' AND "indexatie" = 'jaarlijks_cbs' AND "indexatie_kwartaal" IS NULL;

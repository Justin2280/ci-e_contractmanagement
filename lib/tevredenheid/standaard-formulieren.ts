import type { FormDefinitie } from "./forms";

/**
 * Momentopname (nov 2026) van de twee klanttevredenheidsformulieren in Microsoft Forms. Dient als terugval als
 * Forms niet bereikbaar is; normaal haalt de app de actuele definitie op via de ingestelde formulierlink.
 */
export const STANDAARD_FORM_MEDEWERKER: FormDefinitie = {
  id: "_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUMTlSUUxBR0ZWVFRNUVc2MDYwUFFaNzkwRy4u",
  url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUMTlSUUxBR0ZWVFRNUVc2MDYwUFFaNzkwRy4u",
  titel: "Compact - Klanttevredenheidsformulier - Medewerker - CI-Engineers",
  prefillAan: false,
  vragen: [
    { id: "rb04793936a4841f5bc4e97dff7d032c4", titel: "Uw naam", type: "TextField" },
    { id: "rfda02b56b97d42998035aa392cba844c", titel: "Uw functie", type: "TextField" },
    { id: "r64e6f21b398b4a21b852828c4b659b22", titel: "Uw organisatie", type: "TextField" },
    { id: "r1eff648d682f431d9b8e45b4c6733e4a", titel: "Medewerker die u beoordeelt", type: "TextField" },
    { id: "rb0a10aab15524bfc9a4887070723fbf9", titel: "Projectnaam", type: "TextField" },
    { id: "r9c297cc2607f4df89e67147e178f9afb", titel: "Begrijpt de medewerker de opdracht en vertaalt deze naar een effectieve aanpak?", type: "Rating" },
    { id: "r3b0dbe837de940afb7e4d8a090275b14", titel: "Is de analyse van hoofd- en bijzaken en het leggen van relevante verbanden adequaat?", type: "Rating" },
    { id: "rc803f17b0ee049d8ad5151bca004974b", titel: "Is het geleverde werk inhoudelijk correct, compleet en op het juiste detailniveau?", type: "Rating" },
    { id: "r9ace4fdcf8d443aab7448360376420dc", titel: "Past de medewerker normen, richtlijnen en veiligheidsafspraken correct toe?", type: "Rating" },
    { id: "r01e9d3e610244d14a5b5e0972170313a", titel: "Is het werk accuraat en zorgvuldig uitgewerkt (foutenarm)?", type: "Rating" },
    { id: "r5fba3ed7a691453080c1a36e60dde8ac", titel: "Gebruikt de medewerker de benodigde software/BIM-tools effectief voor het resultaat?", type: "Rating" },
    { id: "rdcc8fd8915eb4897bfa161e2c30aa671", titel: "Komt de medewerker afspraken en deadlines na?", type: "Rating" },
    { id: "r2b6ef631ca7c4c37baf2709f8f7b5176", titel: "Communiceert de medewerker tijdig, duidelijk en professioneel met klant en team?", type: "Rating" },
    { id: "r0c987bfc7c7844908fc7bd6b92dfafaa", titel: "Werkt de medewerker prettig samen en gaat respectvol om met betrokkenen?", type: "Rating" },
    { id: "rc8f3b99527ab450f9ef997311386987a", titel: "Stuurt de medewerker planmatig op voortgang en grijpt tijdig in bij afwijkingen?", type: "Rating" },
    { id: "rfb77dc8126104ed4823422233902ff29", titel: "Toont de medewerker initiatief en doet hij/zij voorstellen die kwaliteit/efficiëntie verbeteren?", type: "Rating" },
    { id: "r4d7ad40dc61f4eb5823e5c6a645dc92a", titel: "Aanbeveling: hoe waarschijnlijk raadt u deze collega aan?", type: "NPS" },
    { id: "rbb106a0d32c14ac88efce34a714480c0", titel: "Wat ging goed in dit project?", type: "TextField" },
    { id: "rbcac3f24054f4cc399a9eba57b4c1879", titel: "Wat kan beter of anders?", type: "TextField" },
    { id: "r4bc77719e46e4ef8999177267b70a152", titel: "Zou u deze medewerker opnieuw inzetten bij een vergelijkbare opdracht? Licht toe.", type: "TextField" },
  ],
};

export const STANDAARD_FORM_JAARLIJKS: FormDefinitie = {
  id: "_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUODlUSVJLQk9KMFk1VFo2N0dUMDZQS0s1MS4u",
  url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=_-onPoyrZEim0Kji_7FvquDqbNXL21VBvlWq-BwfyRJUODlUSVJLQk9KMFk1VFo2N0dUMDZQS0s1MS4u",
  titel: "Klanttevredenheidsformulier over CI-Engineers",
  prefillAan: false,
  vragen: [
    { id: "rb04793936a4841f5bc4e97dff7d032c4", titel: "Uw naam", type: "TextField" },
    { id: "rfda02b56b97d42998035aa392cba844c", titel: "Uw functie", type: "TextField" },
    { id: "r64e6f21b398b4a21b852828c4b659b22", titel: "Uw bedrijf", type: "TextField" },
    { id: "re1d69ac989bf43ee866c55a1f20dd895", titel: "Was de aanbieding duidelijk en concreet omschreven?", type: "Rating" },
    { id: "rcfc1cb8e58e94474b83c5e5f46791579", titel: "Is de aanbieding op tijd gestuurd?", type: "Rating" },
    { id: "r5682b4c2f7c54ed4b7817b39d8f98ad4", titel: "Is er genoeg informatie gegeven om de risico’s van het project goed te managen?", type: "Rating" },
    { id: "r630d31bf0f1b44b69b76b4d9086b801e", titel: "Eventuele toelichting", type: "TextField" },
    { id: "rcd3261becf6e4f2c971ec05f8eb16d3b", titel: "Worden de werkzaamheden conform uw wensen uitgevoerd?", type: "Rating" },
    { id: "r684216d530f54a72b658cf74137b4eb5", titel: "Worden de werkzaamheden conform uw planning uitgevoerd?", type: "Rating" },
    { id: "r0be588e9fcb04b32ba89ba651001bcb6", titel: "Is de communicatie binnen het werk afdoende?", type: "Rating" },
    { id: "ra5556bb25d3649a39212fc3270de5b01", titel: "Bent u tevreden over de ontvangen documentatie en informatie?", type: "Rating" },
    { id: "r68b7d6f80ac64a38a22104c528ce2ab1", titel: "Bent u tevreden over onze wijze van factureren?", type: "Rating" },
    { id: "r641871e4b56e401ea5f5040724fcda96", titel: "Bent u voorzien van goede adviezen door ons?", type: "Rating" },
    { id: "r2d5e8875f626450890718161420b52ec", titel: "Reageren wij voldoende flexibel op afwijkingen en plotselinge problemen?", type: "Rating" },
    { id: "r1648fa440261483fb599d1da3740829d", titel: "Eventuele toelichting", type: "TextField" },
    { id: "r6e21fd6eed3746cabd5a7b3b81b7801f", titel: "Wat is uw mening over de prijs/kwaliteit verhouding?", type: "Rating" },
    { id: "rafd5f34907214d05808040d37d645da5", titel: "Wat is uw mening over de professionaliteit van de organisatie?", type: "Rating" },
    { id: "rf762a300bbed4b49855e8b02e7a539ad", titel: "Wat is uw mening over de professionaliteit van de personen met wie wij communiceren?", type: "Rating" },
    { id: "raae5c359b53c4b59a93bf26bec26ea0c", titel: "Eventuele toelichting", type: "TextField" },
    { id: "rbb106a0d32c14ac88efce34a714480c0", titel: "Zijn er nog andere dingen die u kwijt wilt?", type: "TextField" },
  ],
};


export const normalizeInvoiceText = (value: string) =>
  value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "").trim();

export const normalizeMerchant = (value: string) =>
  value
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/\b(?:PARC(?:ELA)?|P)\s*\d{1,3}\s*(?:\/|DE|-|X)\s*\d{1,3}\b/g, " ")
    .replace(/\b(?:CARTAO|FINAL)\s*\*?\d{4}\b/g, " ")
    .replace(/\b(?:AUT|AUTH|DOC)\s*[:#-]?\s*[A-Z0-9-]+\b/g, " ")
    .replace(/[^A-Z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

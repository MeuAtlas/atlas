import type {
  ExtractedPdfDocument,
  ExtractedPdfPage,
  PdfTextItem,
  PdfVisualLine,
} from "../types";

type Part = [x: number, text: string];

function line(pageNumber: number, y: number, columnIndex: number, parts: Part[]): PdfVisualLine {
  const items: PdfTextItem[] = parts.map(([x, text], visualIndex) => ({
    pageNumber,
    text,
    x,
    y,
    width: Math.max(4, text.length * 3),
    height: 7,
    visualIndex,
  }));
  return {
    pageNumber,
    columnIndex,
    x: Math.min(...items.map(item => item.x)),
    y,
    text: items.map(item => item.text).join(" "),
    items,
  };
}

function page(pageNumber: number, lines: PdfVisualLine[]): ExtractedPdfPage {
  return {
    pageNumber,
    width: 595.3,
    height: 841.9,
    text: lines.map(value => value.text).join("\n"),
    lines: lines.map(value => value.text),
    items: lines.flatMap(value => value.items),
    visualLines: lines,
  };
}

const pageOne = page(1, [
  line(1, 785, 0, [[19, "Santander"]]),
  line(1, 761, 0, [[313, "Total a Pagar"], [412, "Vencimento"]]),
  line(1, 748, 0, [[301, "R$ 1.500,00"], [401, "10/07/2026"]]),
  line(1, 648, 0, [[31, "Pagamento Mínimo R$ 150,00"]]),
  line(1, 620, 0, [[289, "03/06/26 a 03/07/26"]]),
  line(1, 584, 0, [[289, "R$ 200,00 Fatura Aberta 04/07/26 a 03/08/26"]]),
]);

const pageTwo = page(2, [
  line(2, 520, 0, [[10, "PESSOA TESTE - 5228 XXXX XXXX 1111"]]),
  line(2, 496, 0, [[10, "Pagamento e Demais Créditos"]]),
  line(2, 472, 0, [[33, "05/06 PAGAMENTO DE FATURA"], [201, "-200,00"]]),
  line(2, 450, 0, [[10, "Parcelamentos"]]),
  line(2, 426, 0, [[17, "3"], [33, "09/10 MERCHANT A"], [168, "09/10"], [208, "244,18"]]),
  line(2, 381, 0, [[10, "Despesas"]]),
  line(2, 357, 0, [[17, "3"], [33, "03/07 99 RIDE"], [208, "355,82"]]),
  line(2, 242, 1, [[328, "VALOR TOTAL"], [497, "900,00"], [534, "0,00"]]),
  line(2, 215, 1, [[303, "PESSOA TESTE - 5480 XXXX XXXX 2222"]]),
  line(2, 137, 1, [[303, "Parcelamentos"]]),
  line(2, 113, 1, [[327, "01/06 MERCHANT B"], [462, "01/02"], [505, "100,00"]]),
]);

const pageThree = page(3, [
  line(3, 761, 0, [[10, "Parcelamentos"]]),
  line(3, 737, 0, [[33, "01/05 MERCHANT C"], [168, "02/03"], [208, "50,00"]]),
  line(3, 669, 0, [[10, "Despesas"]]),
  line(3, 645, 0, [[33, "02/06 INTERNATIONAL SHOP"], [208, "420,00"], [242, "100,00"]]),
  line(3, 639, 0, [[52, "COTAÇÃO DOLAR R$ 4,2000"]]),
  line(3, 634, 0, [[52, "IOF DESPESA NO EXTERIOR"], [208, "10,00"]]),
  line(3, 613, 0, [[33, "03/07 ANUIDADE DIFERENCIADA"], [208, "20,00"]]),
  line(3, 268, 0, [[34, "VALOR TOTAL"], [203, "600,00"], [234, "100,00"]]),
  line(3, 244, 0, [[10, "Resumo da Fatura"]]),
  line(3, 219, 0, [[32, "Saldo Anterior"], [202, "500,00"]]),
  line(3, 208, 0, [[32, "(+) Total Despesas/Débitos no Brasil"], [199, "1.100,00"]]),
  line(3, 196, 0, [[32, "(+) Total Despesas/Débitos no Exterior"], [207, "100,00"], [233, "20,00"]]),
  line(3, 184, 0, [[32, "(-) Total de pagamentos"], [202, "200,00"]]),
  line(3, 173, 0, [[32, "(-) Total de créditos"], [207, "0,00"]]),
  line(3, 161, 0, [[32, "(=) Saldo Desta Fatura"], [198, "1.500,00"]]),
  line(3, 125, 0, [[10, "Saldo total consolidado de obrigações futuras"]]),
  line(3, 100, 0, [[32, "Compras parceladas com e sem juros: operações de crédito e tarifas"], [198, "394,18"]]),
]);

const pageFour = page(4, [
  line(4, 760, 0, [[10, "Juros e Custo Efetivo Total - informações, não lançamentos"]]),
]);

export const santanderExtractedFixture: ExtractedPdfDocument = {
  pageCount: 4,
  pages: [pageOne, pageTwo, pageThree, pageFour],
  fullText: [pageOne, pageTwo, pageThree, pageFour].map(value => value.text).join("\n\n"),
  metadata: {},
  extractionWarnings: [],
  extractionMethod: "text_layer",
};

export const imageOnlyFixture: ExtractedPdfDocument = {
  pageCount: 1,
  pages: [{
    pageNumber: 1,
    width: 595,
    height: 842,
    text: "",
    lines: [],
    items: [],
    visualLines: [],
  }],
  fullText: "",
  metadata: {},
  extractionWarnings: ["Documento sem camada de texto."],
  extractionMethod: "image_only",
};

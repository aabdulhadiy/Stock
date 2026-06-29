import PDFDocument from "pdfkit";

/**
 * Generic tabular PDF export via pdfkit (pure JS, no browser dependency).
 * Renders a title, an optional subtitle, and one or more striped tables.
 */

export interface PdfColumn {
  header: string;
  key: string;
  weight?: number; // relative column width (default 1)
  align?: "left" | "right";
}

export interface PdfTable {
  heading?: string;
  columns: PdfColumn[];
  rows: Record<string, string | number | null>[];
}

export interface PdfDoc {
  title: string;
  subtitle?: string;
  tables: PdfTable[];
}

const MARGIN = 40;
const ROW_H = 18;
const HEADER_H = 20;

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function tablePdfBuffer(spec: PdfDoc): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const done = pdfToBuffer(doc);

  const left = MARGIN;
  const right = doc.page.width - MARGIN;
  const width = right - left;
  const bottom = doc.page.height - MARGIN;

  doc.font("Helvetica-Bold").fontSize(16).text(spec.title, left, MARGIN);
  if (spec.subtitle) {
    doc.font("Helvetica").fontSize(10).fillColor("#666").text(spec.subtitle);
    doc.fillColor("#000");
  }
  let y = doc.y + 12;

  for (const table of spec.tables) {
    const totalWeight = table.columns.reduce((s, c) => s + (c.weight ?? 1), 0);
    const widths = table.columns.map((c) => (width * (c.weight ?? 1)) / totalWeight);
    const xs: number[] = [];
    table.columns.reduce((x, _c, i) => {
      xs[i] = x;
      return x + widths[i];
    }, left);

    const drawHeader = () => {
      if (table.heading) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(table.heading, left, y);
        y += 16;
      }
      doc.rect(left, y, width, HEADER_H).fill("#eef2ff");
      doc.fillColor("#1e293b").font("Helvetica-Bold").fontSize(9);
      table.columns.forEach((c, i) => {
        doc.text(c.header, xs[i] + 4, y + 6, {
          width: widths[i] - 8,
          align: c.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += HEADER_H;
      doc.fillColor("#000");
    };

    drawHeader();

    table.rows.forEach((row, idx) => {
      if (y + ROW_H > bottom) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }
      if (idx % 2 === 1) doc.rect(left, y, width, ROW_H).fill("#f8fafc").fillColor("#000");
      doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
      table.columns.forEach((c, i) => {
        const val = row[c.key];
        doc.text(val === null || val === undefined ? "" : String(val), xs[i] + 4, y + 5, {
          width: widths[i] - 8,
          align: c.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
      });
      y += ROW_H;
    });

    y += 16;
  }

  doc.end();
  return done;
}

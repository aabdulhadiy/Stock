import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { ExportCell, ExportDoc, ExportTable } from "./types";

/**
 * Print-ready tabular PDF via pdfkit (pure JS, no browser needed).
 *
 * FONTS: pdfkit's built-in Helvetica is WinAnsi-encoded and cannot render
 * Cyrillic, so a Russian export would come out as garbage — unacceptable when
 * §13 makes translated PDF exports an acceptance criterion. DejaVu Sans is
 * vendored under `assets/fonts/` (it covers Latin, Latin-Extended and
 * Cyrillic) and registered here. If the files are somehow missing we fall back
 * to Helvetica rather than failing the download, and Latin output still works.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "DejaVuSans.ttf");
const BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

let fontsChecked = false;
let unicodeFonts = false;

function haveUnicodeFonts(): boolean {
  if (!fontsChecked) {
    fontsChecked = true;
    unicodeFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);
    if (!unicodeFonts) {
      console.warn(
        "[export] DejaVu fonts not found in assets/fonts — PDF exports will " +
          "fall back to Helvetica and cannot render Cyrillic text.",
      );
    }
  }
  return unicodeFonts;
}

const MARGIN = 36;
const ROW_H = 17;
const HEADER_H = 20;

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function cell(value: ExportCell): string {
  return value === null || value === undefined ? "" : String(value);
}

export async function tablePdfBuffer(spec: ExportDoc): Promise<Buffer> {
  // Landscape once a table gets wide, so columns stay readable.
  const widest = spec.tables.reduce((m, t) => Math.max(m, t.columns.length), 0);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    layout: widest > 7 ? "landscape" : "portrait",
    info: { Title: spec.title },
  });
  const done = toBuffer(doc);

  const unicode = haveUnicodeFonts();
  const fontRegular = unicode ? "body" : "Helvetica";
  const fontBold = unicode ? "body-bold" : "Helvetica-Bold";
  if (unicode) {
    doc.registerFont("body", REGULAR);
    doc.registerFont("body-bold", BOLD);
  }

  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN - 14;

  // --- Document header ------------------------------------------------------
  doc.font(fontBold).fontSize(15).fillColor("#0f172a").text(spec.title, left, MARGIN);
  if (spec.subtitle) {
    doc.font(fontRegular).fontSize(9.5).fillColor("#475569").text(spec.subtitle);
  }
  if (spec.note) {
    doc.font(fontBold).fontSize(9).fillColor("#92400e").text(spec.note);
  }
  let y = doc.y + 10;

  for (const table of spec.tables) {
    y = drawTable(doc, table, { left, width, bottom, y, fontRegular, fontBold });
    y += 14;
  }

  // Page numbers — pdfkit exposes the buffered page range.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .font(fontRegular)
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        `${i + 1} / ${range.count}`,
        left,
        doc.page.height - MARGIN + 2,
        { width, align: "right" },
      );
  }

  doc.end();
  return done;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  table: ExportTable,
  ctx: {
    left: number;
    width: number;
    bottom: number;
    y: number;
    fontRegular: string;
    fontBold: string;
  },
): number {
  const { left, width, bottom, fontRegular, fontBold } = ctx;
  let y = ctx.y;

  const totalWeight = table.columns.reduce((s, c) => s + (c.weight ?? 1), 0);
  const widths = table.columns.map((c) => (width * (c.weight ?? 1)) / totalWeight);
  const xs: number[] = [];
  table.columns.reduce((x, _c, i) => {
    xs[i] = x;
    return x + widths[i];
  }, left);

  const drawHeader = () => {
    if (table.title) {
      doc.font(fontBold).fontSize(11).fillColor("#0f172a").text(table.title, left, y);
      y += 15;
    }
    doc.rect(left, y, width, HEADER_H).fill("#eef2ff");
    doc.font(fontBold).fontSize(8.5).fillColor("#1e293b");
    table.columns.forEach((c, i) => {
      doc.text(c.header, xs[i] + 3, y + 6, {
        width: widths[i] - 6,
        align: c.numeric ? "right" : "left",
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += HEADER_H;
  };

  drawHeader();

  const writeRow = (
    row: Record<string, ExportCell>,
    opts: { striped?: boolean; bold?: boolean; rule?: boolean },
  ) => {
    if (opts.striped) {
      doc.rect(left, y, width, ROW_H).fill("#f8fafc");
    }
    if (opts.rule) {
      doc
        .moveTo(left, y)
        .lineTo(left + width, y)
        .lineWidth(1)
        .strokeColor("#94a3b8")
        .stroke();
    }
    doc.font(opts.bold ? fontBold : fontRegular).fontSize(8.5).fillColor("#0f172a");
    table.columns.forEach((c, i) => {
      doc.text(cell(row[c.key]), xs[i] + 3, y + 5, {
        width: widths[i] - 6,
        align: c.numeric ? "right" : "left",
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += ROW_H;
  };

  table.rows.forEach((row, idx) => {
    if (y + ROW_H > bottom) {
      doc.addPage();
      y = MARGIN;
      drawHeader();
    }
    writeRow(row, { striped: idx % 2 === 1 });
  });

  if (table.totals) {
    if (y + ROW_H > bottom) {
      doc.addPage();
      y = MARGIN;
      drawHeader();
    }
    writeRow(table.totals, { bold: true, rule: true });
  }

  return y;
}

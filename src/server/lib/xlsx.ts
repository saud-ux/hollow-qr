/**
 * A small .xlsx (Office Open XML) writer: styled cells, formulas saved with
 * their values, merged cells, frozen headers, filter buttons and conditional
 * colors. Enough for the admin's sales workbook, with no dependency beyond
 * fflate (already used for Wallet passes) and nothing that needs Node.
 *
 * Formulas carry the value they had when written, so viewers that never
 * calculate (iPhone previews) still show the numbers; Excel recalculates on open.
 */
import { strToU8, zipSync, type Zippable } from "fflate";

export interface CellStyle {
  bold?: boolean;
  size?: number;
  /** Text color, "RRGGBB". */
  color?: string;
  /** Background, "RRGGBB". */
  fill?: string;
  border?: "bottom" | "all";
  borderColor?: string;
  /** Excel number format, e.g. "#,##0.00". */
  numFmt?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  indent?: number;
}

/** A value, or a formula (without "=") with the value it gives, in a named style. */
export interface StyledCell {
  v?: string | number | null;
  f?: string;
  s?: string;
}

export type Cell = StyledCell | string | number | null | undefined;

export interface Row {
  cells: Cell[];
  /** Height in points. */
  height?: number;
}

export type Highlight =
  /** Pale at zero, `high` at the largest value. */
  | { type: "colorScale"; ref: string; low: string; high: string }
  | { type: "dataBar"; ref: string; color: string }
  /** Every other row filled. */
  | { type: "stripes"; ref: string; fill: string };

export interface Sheet {
  /** At most 31 characters, none of []:*?/\ */
  name: string;
  tabColor?: string;
  /** Column widths in characters, first column first. */
  widths?: number[];
  rows: Row[];
  merges?: string[];
  /** Rows kept in view at the top while scrolling. */
  frozenRows?: number;
  /** Range with filter buttons on its first row, e.g. "A1:X40". */
  filter?: string;
  highlights?: Highlight[];
  rightToLeft?: boolean;
}

export interface Workbook {
  sheets: Sheet[];
  styles: Record<string, CellStyle>;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAX_CELL_TEXT = 32_767;

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since 1899-12-30, the way Excel stores a date (no time zone: a wall-clock date). */
export function excelDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
}

function escapeXml(text: string): string {
  return text
    // Characters XML 1.0 can't hold (Excel refuses the whole file over one).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const argb = (rgb: string) => `FF${rgb.toUpperCase()}`;

/** styles.xml, and each style name's index into it. */
function compileStyles(styles: Record<string, CellStyle>, stripeFills: string[]) {
  const fonts = ['<font><sz val="11"/><color rgb="FF2B1E16"/><name val="Arial"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  const numFmts: string[] = [];
  const formatIds = new Map<string, number>();
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = new Map<string, number>();
  const idOf = (list: string[], xml: string) => {
    const found = list.indexOf(xml);
    if (found >= 0) return found;
    list.push(xml);
    return list.length - 1;
  };

  for (const [name, st] of Object.entries(styles)) {
    const font = idOf(
      fonts,
      `<font>${st.bold ? "<b/>" : ""}<sz val="${st.size ?? 11}"/><color rgb="${argb(st.color ?? "2B1E16")}"/><name val="Arial"/><family val="2"/></font>`,
    );
    const fill = st.fill ? idOf(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const line = `<color rgb="${argb(st.borderColor ?? "E2D5BF")}"/>`;
    const side = (tag: string, on: boolean) => (on ? `<${tag} style="thin">${line}</${tag}>` : `<${tag}/>`);
    const all = st.border === "all";
    const border = st.border ? idOf(borders, `<border>${side("left", all)}${side("right", all)}${side("top", all)}${side("bottom", true)}<diagonal/></border>`) : 0;
    let fmt = 0;
    if (st.numFmt) {
      fmt = formatIds.get(st.numFmt) ?? 164 + formatIds.size;
      if (!formatIds.has(st.numFmt)) {
        formatIds.set(st.numFmt, fmt);
        numFmts.push(`<numFmt numFmtId="${fmt}" formatCode="${escapeXml(st.numFmt)}"/>`);
      }
    }
    const align = `<alignment horizontal="${st.align ?? "right"}" vertical="center"${st.wrap ? ' wrapText="1"' : ""}${st.indent ? ` indent="${st.indent}"` : ""} readingOrder="2"/>`;
    index.set(name, xfs.length);
    xfs.push(
      `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`,
    );
  }

  const dxfs = stripeFills.map((rgb) => `<dxf><fill><patternFill><bgColor rgb="${argb(rgb)}"/></patternFill></fill></dxf>`);
  const xml =
    XML_HEAD +
    `<styleSheet xmlns="${MAIN_NS}">` +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join("")}</numFmts>` : "") +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="${borders.length}">${borders.join("")}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    `<dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>` +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    "</styleSheet>";
  return { xml, index };
}

function cellXml(ref: string, cell: Cell, styleIndex: Map<string, number>): string {
  if (cell === null || cell === undefined) return "";
  const c: StyledCell = typeof cell === "object" ? cell : { v: cell };
  let s = 0;
  if (c.s !== undefined) {
    const found = styleIndex.get(c.s);
    if (found === undefined) throw new Error(`unknown cell style: ${c.s}`);
    s = found;
  }
  const style = s ? ` s="${s}"` : "";
  const value = c.v ?? null;
  const number = typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = typeof value === "string" ? escapeXml(value.slice(0, MAX_CELL_TEXT)) : null;
  if (c.f !== undefined) {
    const formula = `<f>${escapeXml(c.f)}</f>`;
    if (text !== null) return `<c r="${ref}"${style} t="str">${formula}<v>${text}</v></c>`;
    return `<c r="${ref}"${style}>${formula}${number !== null ? `<v>${number}</v>` : ""}</c>`;
  }
  if (number !== null) return `<c r="${ref}"${style}><v>${number}</v></c>`;
  if (text !== null && text !== "") return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  return s ? `<c r="${ref}"${style}/>` : "";
}

function sheetXml(sheet: Sheet, selected: boolean, styleIndex: Map<string, number>, stripeFills: string[]): string {
  const width = Math.max(1, sheet.widths?.length ?? 0, ...sheet.rows.map((r) => r.cells.length));
  const last = `${columnName(width - 1)}${Math.max(sheet.rows.length, 1)}`;
  const frozen = sheet.frozenRows ?? 0;
  const pane = frozen
    ? `<pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${frozen + 1}" sqref="A${frozen + 1}"/>`
    : "";
  const view = `<sheetView workbookViewId="0"${sheet.rightToLeft === false ? "" : ' rightToLeft="1"'} showGridLines="0"${selected ? ' tabSelected="1"' : ""}>${pane}</sheetView>`;
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.cells.map((cell, c) => cellXml(`${columnName(c)}${r + 1}`, cell, styleIndex)).join("");
      const height = row.height ? ` ht="${row.height}" customHeight="1"` : "";
      return cells || height ? `<row r="${r + 1}"${height}>${cells}</row>` : "";
    })
    .join("");

  let priority = 0;
  const highlights = (sheet.highlights ?? [])
    .map((h) => {
      priority += 1;
      let rule: string;
      if (h.type === "colorScale") {
        rule = `<cfRule type="colorScale" priority="${priority}"><colorScale><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="${argb(h.low)}"/><color rgb="${argb(h.high)}"/></colorScale></cfRule>`;
      } else if (h.type === "dataBar") {
        rule = `<cfRule type="dataBar" priority="${priority}"><dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="${argb(h.color)}"/></dataBar></cfRule>`;
      } else {
        rule = `<cfRule type="expression" dxfId="${stripeFills.indexOf(h.fill)}" priority="${priority}"><formula>MOD(ROW(),2)=0</formula></cfRule>`;
      }
      return `<conditionalFormatting sqref="${h.ref}">${rule}</conditionalFormatting>`;
    })
    .join("");

  return (
    XML_HEAD +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheetPr>${sheet.tabColor ? `<tabColor rgb="${argb(sheet.tabColor)}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews>${view}</sheetViews>` +
    '<sheetFormatPr defaultRowHeight="20" customHeight="1"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    (sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : "") +
    (sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "") +
    highlights +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    "</worksheet>"
  );
}

/** The workbook as .xlsx bytes. */
export function writeXlsx(book: Workbook): Uint8Array {
  if (book.sheets.length === 0) throw new Error("a workbook needs at least one sheet");
  const stripeFills = [
    ...new Set(book.sheets.flatMap((s) => (s.highlights ?? []).flatMap((h) => (h.type === "stripes" ? [h.fill] : [])))),
  ];
  const styles = compileStyles(book.styles, stripeFills);
  const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
  const absolute = (range: string) => range.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");

  const filterNames = book.sheets
    .map((s, i) =>
      s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(`${quoted(s.name)}!${absolute(s.filter)}`)}</definedName>` : "",
    )
    .join("");
  const workbook =
    XML_HEAD +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>' +
    `<sheets>${book.sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    (filterNames ? `<definedNames>${filterNames}</definedNames>` : "") +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    "</workbook>";

  const sheetRels = book.sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  const files: Zippable = {
    "[Content_Types].xml": strToU8(
      XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        book.sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("") +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheetRels +
        `<Relationship Id="rId${book.sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ),
    "xl/styles.xml": strToU8(styles.xml),
  };
  book.sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet, i === 0, styles.index, stripeFills));
  });
  return zipSync(files, { level: 6 });
}

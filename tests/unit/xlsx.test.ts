import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { columnName, excelDate, writeXlsx } from "../../src/server/lib/xlsx";
import { salesWorkbook } from "../../src/server/reports/sales-workbook";
import type { AdminOrder } from "../../src/shared/ordering";

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]));

describe("xlsx writer", () => {
  it("names columns and dates the way Excel does", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    expect(excelDate(1900, 3, 1)).toBe(61);
    expect(excelDate(2026, 10, 20)).toBe(46315);
  });

  it("writes styled cells, formulas with their values, and right-to-left sheets", () => {
    const file = parts(
      writeXlsx({
        styles: { head: { bold: true, fill: "7A4E2D", color: "FFFFFF" }, money: { numFmt: '#,##0.00 "ر.س"' } },
        sheets: [
          {
            name: "المبيعات",
            widths: [12, 14],
            rows: [{ cells: [{ v: "الصنف <1> & \"2\"\u0001", s: "head" }, { v: "المبلغ", s: "head" }] }, { cells: ["قهوة", { v: 12.5, s: "money" }] }, { cells: [null, { v: 12.5, f: "SUM(B2:B2)", s: "money" }] }],
            frozenRows: 1,
            filter: "A1:B2",
            merges: ["A3:A3"],
            highlights: [{ type: "stripes", ref: "A2:B2", fill: "F9F4EA" }],
          },
        ],
      }),
    );
    expect(Object.keys(file)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]),
    );
    const sheet = file["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain("الصنف &lt;1&gt; &amp; &quot;2&quot;</t>");
    expect(sheet).toContain("<f>SUM(B2:B2)</f><v>12.5</v>");
    expect(sheet).toContain('<autoFilter ref="A1:B2"/>');
    expect(sheet).toContain("<formula>MOD(ROW(),2)=0</formula>");
    expect(file["xl/workbook.xml"]).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'المبيعات'!$A$1:$B$2</definedName>`);
    expect(file["xl/styles.xml"]).toContain('formatCode="#,##0.00 &quot;ر.س&quot;"');
  });

  it("refuses an unknown style", () => {
    expect(() => writeXlsx({ styles: {}, sheets: [{ name: "x", rows: [{ cells: [{ v: 1, s: "nope" }] }] }] })).toThrow("unknown cell style");
  });
});

describe("sales workbook", () => {
  const order = (n: number, status: AdminOrder["status"], total: number, wallet = 0) =>
    ({
      id: `o${n}`,
      orderNumber: n,
      customerName: "سارة",
      customerPhone: "0512345678",
      memberId: "HLW-A7K2QX",
      fulfillment: "pickup",
      subtotalHalalas: total,
      deliveryFeeHalalas: 0,
      discountHalalas: 0,
      totalHalalas: total,
      walletHalalas: wallet,
      couponHalalas: 0,
      giftHalalas: 0,
      useReward: false,
      status,
      cancelReason: null,
      createdAt: `2026-10-1${n}T09:15:00Z`,
      items: [{ menuItemId: "m1", nameAr: "قهوة اليوم حارة", category: "drink", unitPriceHalalas: total, listPriceHalalas: null, quantity: 1, note: null, optionId: null, optionNameAr: null }],
      rating: n === 1 ? 5 : null,
      promoPercent: null,
      promoSavingsHalalas: 0,
      completedByName: "أحمد",
    }) as unknown as AdminOrder;

  it("sums the completed orders with formulas, saving their values", () => {
    const file = parts(
      salesWorkbook({
        orders: [order(1, "completed", 1200), order(2, "completed", 1800, 500), order(3, "cancelled", 900)],
        from: "2026-10-11",
        to: "2026-10-13",
        now: new Date("2026-10-20T12:00:00Z"),
      }),
    );
    expect(file["xl/workbook.xml"]).toMatch(/الملخص.*المبيعات اليومية.*الأصناف.*أوقات الذروة.*الطلبات.*بنود الطلبات/);
    const summary = file["xl/worksheets/sheet1.xml"]!;
    // Two completed orders: 12 + 18 riyals, 5 of it from the balance.
    expect(summary).toContain(`<f>COUNTIF('الطلبات'!$J:$J,&quot;مكتمل&quot;)</f><v>2</v>`);
    expect(summary).toContain(`<f>SUMIFS('الطلبات'!$R:$R,'الطلبات'!$J:$J,&quot;مكتمل&quot;)</f><v>30</v>`);
    expect(summary).toContain(`<f>SUMIFS('الطلبات'!$T:$T,'الطلبات'!$J:$J,&quot;مكتمل&quot;)</f><v>25</v>`);
    expect(summary).toContain("<v>0.3333333333333333</v>"); // one of three cancelled
    const days = file["xl/worksheets/sheet2.xml"]!;
    expect(days.match(/<row r="(\d+)"/g)).toHaveLength(7); // title, period, header, 3 days, total
    const orders = file["xl/worksheets/sheet5.xml"]!;
    expect(orders).toContain("<f>R3-S3</f><v>13</v>");
    expect(orders).toContain("ملغي");
  });

  it("names the day for a one-day summary, without a best day", () => {
    const summary = parts(salesWorkbook({ orders: [order(1, "completed", 1200)], from: "2026-10-11", to: "2026-10-11", now: new Date("2026-10-20T12:00:00Z") }))[
      "xl/worksheets/sheet1.xml"
    ]!;
    expect(summary).toContain("الفترة: يوم الأحد 2026-10-11");
    expect(summary).not.toContain("أفضل يوم مبيعات");
    expect(summary).toContain(`<f>COUNTIF('الطلبات'!$J:$J,&quot;مكتمل&quot;)</f><v>1</v>`);
  });

  it("still opens with no orders", () => {
    const file = parts(salesWorkbook({ orders: [], from: null, to: null, now: new Date("2026-10-20T12:00:00Z") }));
    expect(file["xl/worksheets/sheet3.xml"]).toContain("لا توجد مبيعات مكتملة في هذه الفترة");
    expect(file["xl/worksheets/sheet2.xml"]).toContain("لا توجد طلبات في هذه الفترة");
  });
});

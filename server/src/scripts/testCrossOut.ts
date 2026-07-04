import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { generateCrossImage } from "../services/pngGenerator";

// Replicating internal border and data functions for isolated unit testing of core logic
function hasBorder(cell: ExcelJS.Cell): boolean {
  const b = cell.border;
  if (!b) return false;
  if (b.top && b.top.style) return true;
  if (b.bottom && b.bottom.style) return true;
  if (b.left && b.left.style) return true;
  if (b.right && b.right.style) return true;
  return false;
}

function getCellText(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    if ("result" in val) {
      return val.result !== null && val.result !== undefined ? String(val.result).trim() : "";
    }
    if ("text" in val) {
      return val.text !== null && val.text !== undefined ? String(val.text).trim() : "";
    }
    if ("formula" in val) {
      return "";
    }
  }
  return String(val).trim();
}

async function testMain() {
  console.log("=== STARTING CROSS-OUT LOGIC VERIFICATION ===");

  const testDir = path.resolve(__dirname, "../../test-results");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFilePath = path.join(testDir, "test_template.xlsx");
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Nghiem thu");

  // Write title
  ws.getCell("B2").value = "BẢNG NGHIỆM THU CAO ĐỘ VÀ TỌA ĐỘ";
  ws.getCell("B2").font = { bold: true, size: 16 };

  // Setup a bordered table from row 5 to 25, columns B to G (cols 2 to 7)
  const startRow = 5;
  const endRow = 25;
  const startCol = 2;
  const endCol = 7;

  // Header row
  ws.getRow(5).values = ["", "STT", "Tên Mốc", "Tọa độ X", "Tọa độ Y", "Cao độ H", "Ghi chú"];
  ws.getRow(5).font = { bold: true };

  // Write border styling for rows 5 to 25
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" },
    bottom: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
  };

  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);
    for (let c = startCol; c <= endCol; c++) {
      row.getCell(c).border = thinBorder;
    }
  }

  // Fill actual data from rows 6 to 12
  for (let r = 6; r <= 12; r++) {
    const row = ws.getRow(r);
    row.getCell(2).value = r - 5; // STT
    row.getCell(3).value = `Mốc ${r - 5}`;
    row.getCell(4).value = 100.23 + r;
    row.getCell(5).value = 200.45 - r;
    row.getCell(6).value = 5.6 + r * 0.1;
  }

  // Rows 13 to 25 are left blank (they have borders but no content)
  console.log(`Created sample sheet with table at rows ${startRow}-${endRow}, data up to row 12.`);
  await workbook.xlsx.writeFile(testFilePath);
  console.log(`Saved sample template to: ${testFilePath}`);

  // Test detection logic on the saved file
  console.log("\n--- TESTING TABLE DETECTION LOGIC ---");
  const readWorkbook = new ExcelJS.Workbook();
  await readWorkbook.xlsx.readFile(testFilePath);
  const testWs = readWorkbook.getWorksheet("Nghiem thu")!;

  // Auto column index search
  let maxCol = 1;
  testWs.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > maxCol) maxCol = colNumber;
    });
  });

  console.log(`Active Max Column index found: ${maxCol}`);

  // Scan rows for borders
  const borderedRows: boolean[] = [];
  for (let r = 1; r <= testWs.rowCount; r++) {
    const row = testWs.getRow(r);
    let borderCount = 0;
    for (let c = 1; c <= maxCol; c++) {
      if (hasBorder(row.getCell(c))) {
        borderCount++;
      }
    }
    borderedRows[r] = borderCount >= 3;
  }

  // Group rows
  let blockStart = 0;
  let inTable = false;
  let detectedTables: { start: number; end: number }[] = [];

  for (let r = 1; r <= testWs.rowCount; r++) {
    if (borderedRows[r]) {
      if (!inTable) {
        inTable = true;
        blockStart = r;
      }
    } else {
      if (inTable) {
        const blockEnd = r - 1;
        if (blockEnd - blockStart >= 2) {
          detectedTables.push({ start: blockStart, end: blockEnd });
        }
        inTable = false;
      }
    }
  }
  if (inTable) {
    detectedTables.push({ start: blockStart, end: testWs.rowCount });
  }

  console.log("Detected tables:", detectedTables);
  if (detectedTables.length === 0) {
    console.error("FAIL: No tables detected!");
    process.exit(1);
  }

  const targetTable = detectedTables[0];
  console.log(`SUCCESS: Detected Table at rows ${targetTable.start} to ${targetTable.end}`);

  // Find last data row in target table columns B to G (cols 2 to 7)
  let lastDataRow = targetTable.start;
  for (let r = targetTable.end; r >= targetTable.start; r--) {
    const row = testWs.getRow(r);
    let rowHasData = false;
    for (let c = startCol; c <= endCol; c++) {
      if (getCellText(row.getCell(c)) !== "") {
        rowHasData = true;
        break;
      }
    }
    if (rowHasData) {
      lastDataRow = r;
      break;
    }
  }

  console.log(`Last row containing data in the table is row: ${lastDataRow}`);
  if (lastDataRow !== 12) {
    console.error(`FAIL: Expected last data row to be 12, but found: ${lastDataRow}`);
    process.exit(1);
  }
  console.log(`Empty region calculated: rows ${lastDataRow + 1} to ${targetTable.end}`);

  // Test drawing PNG shapes and embedding
  console.log("\n--- TESTING PNG DRAWING AND IMAGE EMBED ---");
  
  // Style 1: greater_than (Arrow style)
  const arrowPng = generateCrossImage("greater_than", "#0000FF", 4, 1000, 1000);
  const arrowImgId = readWorkbook.addImage({
    buffer: Buffer.from(arrowPng) as any,
    extension: "png",
  });
  
  testWs.addImage(arrowImgId, {
    tl: { col: startCol - 1, row: lastDataRow } as any,
    br: { col: endCol, row: targetTable.end } as any,
    editAs: "twoCell",
  } as any);

  const outputFilePath = path.join(testDir, "test_output_arrow.xlsx");
  await readWorkbook.xlsx.writeFile(outputFilePath);
  console.log(`SUCCESS: Saved output with Arrow '>' drawing to: ${outputFilePath}`);

  // Style 2: single_diagonal_up (Diagonal up line /)
  const readWorkbook2 = new ExcelJS.Workbook();
  await readWorkbook2.xlsx.readFile(testFilePath);
  const testWs2 = readWorkbook2.getWorksheet("Nghiem thu")!;
  
  const diagPng = generateCrossImage("single_diagonal_up", "#FF0000", 5, 1000, 1000);
  const diagImgId = readWorkbook2.addImage({
    buffer: Buffer.from(diagPng) as any,
    extension: "png",
  });

  testWs2.addImage(diagImgId, {
    tl: { col: startCol - 1, row: lastDataRow } as any,
    br: { col: endCol, row: targetTable.end } as any,
    editAs: "twoCell",
  } as any);

  const outputFilePathDiag = path.join(testDir, "test_output_diagonal.xlsx");
  await readWorkbook2.xlsx.writeFile(outputFilePathDiag);
  console.log(`SUCCESS: Saved output with Diagonal '/' drawing to: ${outputFilePathDiag}`);

  console.log("\n=== ALL TEST CHECKS PASSED SUCCESSFULLY ===");
}

testMain().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

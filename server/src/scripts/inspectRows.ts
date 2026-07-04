import ExcelJS from "exceljs";
import path from "path";

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

async function main() {
  const filePath = path.resolve(__dirname, "../../uploads/c0aaf7af-666b-4a35-a75c-d6972f5e1077/DS Ä_RL HK 3(2024-2025).xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet("TỔNG")!;

  console.log("=== INSPECTING ROWS 530 TO 540 IN SHEET TỔNG ===");
  for (let r = 530; r <= 540; r++) {
    const row = ws.getRow(r);
    console.log(`\nRow ${r}:`);
    let rowHasBorders = false;
    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      const val = cell.value;
      const text = getCellText(cell);
      const border = cell.border ? "YES" : "NO";
      if (cell.border) rowHasBorders = true;
      
      console.log(`  Col ${c}: Val=${JSON.stringify(val)} (Type=${typeof val}) Text="${text}" Border=${border}`);
    }
    console.log(`  RowHasBorders: ${rowHasBorders}`);
  }
}

main().catch(console.error);

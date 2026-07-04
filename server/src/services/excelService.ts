import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import prisma from "../db";
import { generateCrossImage } from "./pngGenerator";

export interface CrossingRules {
  mode: "cross_out" | "strike" | "highlight" | "fill_value" | "delete_row";
  fillValue?: string;
  highlightColor?: string; // Hex format e.g. "#FF0000" or ARGB
  crossType?: "single_diagonal_up" | "single_diagonal_down" | "greater_than";
  crossColor?: string; // Hex color for the pen
  crossThickness?: number; // Line thickness in pixels
  sheets?: {
    sheetName: string;
    enabled: boolean;
    mode: "auto" | "manual";
    tables: {
      startRow: number;
      endRow: number;
      startCol?: number;
      endCol?: number;
    }[];
  }[];
}

export type CleaningRules = CrossingRules;

interface SheetReport {
  sheetName: string;
  totalRows: number;
  emptyCells: number; // For cross_out mode, this represents the count of crossed-out rows
}

export interface TableInfo {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  lastDataRow: number;
}

export interface SheetAnalysis {
  sheetName: string;
  tables: TableInfo[];
}

/**
 * Standardize hex color to ARGB for ExcelJS.
 */
function getArgbColor(hex: string | undefined): string {
  if (!hex) return "FFFF0000"; // Default red
  let cleaned = hex.replace("#", "").trim();
  if (cleaned.length === 6) {
    return "FF" + cleaned.toUpperCase();
  }
  if (cleaned.length === 8) {
    return cleaned.toUpperCase();
  }
  return "FFFF0000";
}

/**
 * Check if a cell value is empty
 */
function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

/**
 * Helper to check if a cell has any custom border
 */
function hasBorder(cell: ExcelJS.Cell): boolean {
  const b = cell.border;
  if (!b) return false;
  if (b.top && b.top.style) return true;
  if (b.bottom && b.bottom.style) return true;
  if (b.left && b.left.style) return true;
  if (b.right && b.right.style) return true;
  return false;
}

/**
 * Clean cell text helper
 */
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

/**
 * Find the last row with data in the table range
 */
function findLastDataRow(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number
): number {
  for (let r = endRow; r >= startRow; r--) {
    const row = worksheet.getRow(r);
    let hasData = false;
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      if (getCellText(cell) !== "") {
        hasData = true;
        break;
      }
    }
    if (hasData) {
      return r;
    }
  }
  return startRow; // fallback to table header
}

/**
 * Detect columns of a manual table by checking borders in the rows range
 */
function findTableColumns(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  maxCol: number
): { startCol: number; endCol: number } {
  let minCol = Infinity;
  let maxColInRow = -Infinity;

  for (let r = startRow; r <= endRow; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      if (hasBorder(row.getCell(c))) {
        if (c < minCol) minCol = c;
        if (c > maxColInRow) maxColInRow = c;
      }
    }
  }

  if (minCol === Infinity || maxColInRow === -Infinity) {
    return { startCol: 1, endCol: Math.min(10, maxCol) };
  }
  return { startCol: minCol, endCol: maxColInRow };
}

/**
 * Analyze an Excel file and identify all sheets and their bordered tables
 */
export async function analyzeExcelFile(fileId: string): Promise<SheetAnalysis[]> {
  const excelFile = await prisma.excelFile.findUnique({
    where: { id: fileId },
  });

  if (!excelFile) {
    throw new Error(`ExcelFile record not found: ${fileId}`);
  }

  const originalPath = path.resolve(excelFile.originalUrl);
  if (!fs.existsSync(originalPath)) {
    throw new Error(`Original file not found on disk at: ${originalPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(originalPath);

  const analysis: SheetAnalysis[] = [];

  workbook.eachSheet((worksheet) => {
    const totalRows = worksheet.rowCount;
    
    // Find active max columns
    let maxCol = 1;
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > maxCol) {
          maxCol = colNumber;
        }
      });
    });

    const borderedRows: boolean[] = [];
    const rowColBounds: { min: number; max: number }[] = [];

    for (let r = 1; r <= totalRows; r++) {
      const row = worksheet.getRow(r);
      let borderCount = 0;
      let minCol = Infinity;
      let maxColInRow = -Infinity;

      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        if (hasBorder(cell)) {
          borderCount++;
          if (c < minCol) minCol = c;
          if (c > maxColInRow) maxColInRow = c;
        }
      }

      // Check if row has border formatting (at least 3 columns have borders, or 2 for narrow sheets)
      const isBordered = borderCount >= 3 || (borderCount >= 2 && maxCol <= 4);
      borderedRows[r] = isBordered;
      rowColBounds[r] = {
        min: minCol === Infinity ? 1 : minCol,
        max: maxColInRow === -Infinity ? maxCol : maxColInRow,
      };
    }

    const tables: TableInfo[] = [];
    let inTable = false;
    let blockStart = 0;
    let blockMinCol = Infinity;
    let blockMaxCol = -Infinity;
    let gapCount = 0;

    for (let r = 1; r <= totalRows; r++) {
      const isBordered = borderedRows[r];

      if (isBordered) {
        if (!inTable) {
          inTable = true;
          blockStart = r;
          blockMinCol = rowColBounds[r].min;
          blockMaxCol = rowColBounds[r].max;
          gapCount = 0;
        } else {
          blockMinCol = Math.min(blockMinCol, rowColBounds[r].min);
          blockMaxCol = Math.max(blockMaxCol, rowColBounds[r].max);
          gapCount = 0;
        }
      } else {
        if (inTable) {
          gapCount++;
          // Allow up to 1 row gap inside table
          if (gapCount > 1) {
            const blockEnd = r - gapCount;
            if (blockEnd - blockStart >= 2) { // minimum 3 rows
              tables.push({
                startRow: blockStart,
                endRow: blockEnd,
                startCol: blockMinCol,
                endCol: blockMaxCol,
                lastDataRow: findLastDataRow(worksheet, blockStart, blockEnd, blockMinCol, blockMaxCol),
              });
            }
            inTable = false;
            blockMinCol = Infinity;
            blockMaxCol = -Infinity;
          }
        }
      }
    }

    if (inTable) {
      const blockEnd = totalRows - gapCount;
      if (blockEnd - blockStart >= 2) {
        tables.push({
          startRow: blockStart,
          endRow: blockEnd,
          startCol: blockMinCol,
          endCol: blockMaxCol,
          lastDataRow: findLastDataRow(worksheet, blockStart, blockEnd, blockMinCol, blockMaxCol),
        });
      }
    }

    analysis.push({
      sheetName: worksheet.name,
      tables,
    });
  });

  return analysis;
}

/**
 * Main function to process Excel file and apply cleaning or cross-out rules
 */
export async function processExcelFile(
  fileId: string,
  rules: CrossingRules
): Promise<{ resultPath: string; reports: SheetReport[] }> {
  const excelFile = await prisma.excelFile.findUnique({
    where: { id: fileId },
  });

  if (!excelFile) {
    throw new Error(`ExcelFile record not found: ${fileId}`);
  }

  const originalPath = path.resolve(excelFile.originalUrl);
  if (!fs.existsSync(originalPath)) {
    throw new Error(`Original file not found on disk at: ${originalPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(originalPath);

  const reports: SheetReport[] = [];
  const resultsDir = path.resolve(process.env.RESULT_DIR || "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const fileResultsDir = path.join(resultsDir, fileId);
  if (!fs.existsSync(fileResultsDir)) {
    fs.mkdirSync(fileResultsDir, { recursive: true });
  }
  
  // Create output file path, modifying name slightly to represent the crossing out
  const suffix = rules.mode === "cross_out" ? "_gach_cheo" : "_processed";
  const ext = path.extname(excelFile.fileName);
  const base = path.basename(excelFile.fileName, ext);
  const resultFileName = `${base}${suffix}${ext}`;
  const resultPath = path.join(fileResultsDir, resultFileName);

  // If in new cross-out mode
  if (rules.mode === "cross_out") {
    const crossType = rules.crossType || "greater_than";
    const crossColor = rules.crossColor || "#0000FF";
    const crossThickness = rules.crossThickness || 4;
    const sheetsConfig = rules.sheets || [];

    for (const sheetConf of sheetsConfig) {
      if (!sheetConf.enabled) continue;
      
      const worksheet = workbook.getWorksheet(sheetConf.sheetName);
      if (!worksheet) continue;

      let crossedCount = 0;
      const totalRows = worksheet.rowCount;

      // Find max columns
      let maxCol = 1;
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber > maxCol) maxCol = colNumber;
        });
      });

      for (const t of sheetConf.tables) {
        const startRow = t.startRow;
        const endRow = t.endRow;
        if (startRow <= 0 || endRow < startRow) continue;

        // Auto-detect columns and last data row
        const { startCol, endCol } = findTableColumns(worksheet, startRow, endRow, maxCol);
        const lastDataRow = findLastDataRow(worksheet, startRow, endRow, startCol, endCol);

        if (lastDataRow < endRow) {
          const crossStartRow = lastDataRow + 1;
          const crossEndRow = endRow;
          const heightRows = crossEndRow - crossStartRow + 1;
          crossedCount += heightRows;

          // Generate custom PNG cross-out drawing
          const pngBuffer = generateCrossImage(crossType, crossColor, crossThickness, 1000, 1000);
          const imageId = workbook.addImage({
            buffer: Buffer.from(pngBuffer) as any,
            extension: "png",
          });

          // Insert drawing stretched exactly over the target cell block
          worksheet.addImage(imageId, {
            tl: { col: startCol - 1, row: lastDataRow } as any, // top of crossStartRow
            br: { col: endCol, row: crossEndRow } as any, // bottom of crossEndRow
            editAs: "twoCell",
          } as any);
        }
      }

      reports.push({
        sheetName: worksheet.name,
        totalRows,
        emptyCells: crossedCount,
      });
    }
  } else {
    // FALLBACK TO ORIGINAL EXCEL CLEANER LOGIC
    workbook.eachSheet((worksheet) => {
      let emptyCellsCount = 0;
      const totalRows = worksheet.rowCount;

      let maxCol = 1;
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        if (row.actualCellCount > 0) {
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            if (colNumber > maxCol) maxCol = colNumber;
          });
        }
      });

      if (rules.mode === "delete_row") {
        for (let r = totalRows; r >= 1; r--) {
          const row = worksheet.getRow(r);
          let hasEmptyCell = false;
          let isEntireRowEmpty = true;
          for (let c = 1; c <= maxCol; c++) {
            const val = row.getCell(c).value;
            if (!isEmpty(val)) {
              isEntireRowEmpty = false;
              break;
            }
          }

          if (isEntireRowEmpty) {
            worksheet.spliceRows(r, 1);
            continue;
          }

          for (let c = 1; c <= maxCol; c++) {
            const val = row.getCell(c).value;
            if (isEmpty(val)) {
              hasEmptyCell = true;
              emptyCellsCount++;
            }
          }

          if (hasEmptyCell) {
            worksheet.spliceRows(r, 1);
          }
        }
      } else {
        for (let r = 1; r <= totalRows; r++) {
          const row = worksheet.getRow(r);
          let isEntireRowEmpty = true;
          for (let c = 1; c <= maxCol; c++) {
            if (!isEmpty(row.getCell(c).value)) {
              isEntireRowEmpty = false;
              break;
            }
          }
          if (isEntireRowEmpty) continue;

          for (let c = 1; c <= maxCol; c++) {
            const cell = row.getCell(c);
            if (isEmpty(cell.value)) {
              emptyCellsCount++;

              if (rules.mode === "strike") {
                cell.font = { ...cell.font, strike: true };
              } else if (rules.mode === "highlight") {
                const argbColor = getArgbColor(rules.highlightColor);
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: argbColor },
                };
              } else if (rules.mode === "fill_value") {
                cell.value = rules.fillValue !== undefined ? rules.fillValue : "N/A";
              }
            }
          }
        }
      }

      reports.push({
        sheetName: worksheet.name,
        totalRows,
        emptyCells: emptyCellsCount,
      });
    });
  }

  // Save modified Excel workbook to disk
  await workbook.xlsx.writeFile(resultPath);

  // Update original file name to return the new output filename
  await prisma.excelFile.update({
    where: { id: fileId },
    data: { fileName: resultFileName },
  });

  return {
    resultPath,
    reports,
  };
}

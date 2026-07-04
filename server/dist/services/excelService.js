"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processExcelFile = processExcelFile;
const exceljs_1 = __importDefault(require("exceljs"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = __importDefault(require("../db"));
/**
 * Standardize hex color to ARGB for ExcelJS.
 * E.g., "#FF0000" -> "FFFF0000", "ff3300" -> "FFFF3300"
 */
function getArgbColor(hex) {
    if (!hex)
        return "FFFF0000"; // Default red
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
 * Check if a cell value is empty (null, undefined, or empty string)
 */
function isEmpty(value) {
    if (value === null || value === undefined)
        return true;
    if (typeof value === "string" && value.trim() === "")
        return true;
    return false;
}
async function processExcelFile(fileId, rules) {
    // Fetch file metadata from DB
    const excelFile = await db_1.default.excelFile.findUnique({
        where: { id: fileId },
    });
    if (!excelFile) {
        throw new Error(`ExcelFile record not found: ${fileId}`);
    }
    const originalPath = path_1.default.resolve(excelFile.originalUrl);
    if (!fs_1.default.existsSync(originalPath)) {
        throw new Error(`Original file not found on disk at: ${originalPath}`);
    }
    const workbook = new exceljs_1.default.Workbook();
    await workbook.xlsx.readFile(originalPath);
    const reports = [];
    const resultsDir = path_1.default.resolve(process.env.RESULT_DIR || "results");
    if (!fs_1.default.existsSync(resultsDir)) {
        fs_1.default.mkdirSync(resultsDir, { recursive: true });
    }
    const fileResultsDir = path_1.default.join(resultsDir, fileId);
    if (!fs_1.default.existsSync(fileResultsDir)) {
        fs_1.default.mkdirSync(fileResultsDir, { recursive: true });
    }
    const resultPath = path_1.default.join(fileResultsDir, excelFile.fileName);
    // Process each worksheet
    workbook.eachSheet((worksheet) => {
        let emptyCellsCount = 0;
        const totalRows = worksheet.rowCount;
        // Determine the active column boundary.
        // ExcelJS columnCount might return a large number, let's find the max column index that contains data.
        let maxCol = 1;
        worksheet.eachRow({ includeEmpty: true }, (row) => {
            if (row.actualCellCount > 0) {
                row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                    if (colNumber > maxCol) {
                        maxCol = colNumber;
                    }
                });
            }
        });
        if (rules.mode === "delete_row") {
            // Iterate backwards to safely delete rows without shifting indices of upcoming rows
            for (let r = totalRows; r >= 1; r--) {
                const row = worksheet.getRow(r);
                let hasEmptyCell = false;
                // A row is considered empty or having empty cells if any of the active columns contain empty value.
                // But let's skip row if the entire row is completely empty beyond the active range.
                let isEntireRowEmpty = true;
                for (let c = 1; c <= maxCol; c++) {
                    const val = row.getCell(c).value;
                    if (!isEmpty(val)) {
                        isEntireRowEmpty = false;
                        break;
                    }
                }
                if (isEntireRowEmpty) {
                    // The row is completely blank, we just remove it or ignore. Let's delete it.
                    worksheet.spliceRows(r, 1);
                    continue;
                }
                // Check if there is an empty cell in the row
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
        }
        else {
            // For non-deletion modes, modify cells in place
            for (let r = 1; r <= totalRows; r++) {
                const row = worksheet.getRow(r);
                // Check if the entire row is empty to skip styling columns
                let isEntireRowEmpty = true;
                for (let c = 1; c <= maxCol; c++) {
                    if (!isEmpty(row.getCell(c).value)) {
                        isEntireRowEmpty = false;
                        break;
                    }
                }
                if (isEntireRowEmpty)
                    continue;
                for (let c = 1; c <= maxCol; c++) {
                    const cell = row.getCell(c);
                    if (isEmpty(cell.value)) {
                        emptyCellsCount++;
                        if (rules.mode === "strike") {
                            cell.font = { ...cell.font, strike: true };
                        }
                        else if (rules.mode === "highlight") {
                            const argbColor = getArgbColor(rules.highlightColor);
                            cell.fill = {
                                type: "pattern",
                                pattern: "solid",
                                fgColor: { argb: argbColor },
                            };
                        }
                        else if (rules.mode === "fill_value") {
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
    // Write workbook to results file
    await workbook.xlsx.writeFile(resultPath);
    return {
        resultPath,
        reports,
    };
}

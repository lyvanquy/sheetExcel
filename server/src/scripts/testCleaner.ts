import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import prisma from "../db";
import { processExcelFile, CleaningRules } from "../services/excelService";

async function runTest() {
  console.log("=== EXCEL CLEANER CLI VALIDATION TEST ===");

  // Ensure directories exist
  const uploadsDir = path.resolve("uploads");
  const resultsDir = path.resolve("results");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  // 1. Create a dummy Excel sheet programmatically
  const sampleFilePath = path.join(uploadsDir, "test_sample.xlsx");
  const workbook = new ExcelJS.Workbook();
  
  // Sheet 1: Staff Directory (contains nulls, empty strings)
  const sheet1 = workbook.addWorksheet("Staff Directory");
  sheet1.columns = [
    { header: "Name", key: "name", width: 20 },
    { header: "Email", key: "email", width: 25 },
    { header: "Department", key: "dept", width: 15 },
    { header: "Salary", key: "salary", width: 15 },
  ];
  sheet1.addRow({ name: "Alice Smith", email: "alice@example.com", dept: "HR", salary: 5000 });
  sheet1.addRow({ name: "Bob Johnson", email: "", dept: "Engineering", salary: 7000 }); // Empty email
  sheet1.addRow({ name: "Charlie Brown", email: "charlie@example.com", dept: null, salary: null }); // Empty dept and salary
  sheet1.addRow({ name: "David Miller", email: "david@example.com", dept: "Sales", salary: 4500 });
  sheet1.addRow({ name: "", email: "", dept: "", salary: "" }); // Blank row

  // Sheet 2: Inventory
  const sheet2 = workbook.addWorksheet("Inventory");
  sheet2.columns = [
    { header: "Product ID", key: "id", width: 15 },
    { header: "Stock Count", key: "stock", width: 15 },
    { header: "Price", key: "price", width: 15 },
  ];
  sheet2.addRow({ id: "P101", stock: 120, price: 19.99 });
  sheet2.addRow({ id: "P102", stock: null, price: 5.50 }); // Empty stock
  sheet2.addRow({ id: "P103", stock: 50, price: null }); // Empty price

  await workbook.xlsx.writeFile(sampleFilePath);
  console.log(`Generated sample Excel file with empty cells at: ${sampleFilePath}`);

  // 2. Insert dummy User
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: { 
        email: "tester@example.com",
        password: "testpassword",
      },
    });
  }

  // 3. Save ExcelFile record
  const fileRules: CleaningRules = {
    mode: "strike",
  };

  const excelRecord = await prisma.excelFile.create({
    data: {
      fileName: "test_sample.xlsx",
      originalUrl: "uploads/test_sample.xlsx",
      status: "PENDING",
      rules: JSON.stringify(fileRules),
      userId: user.id,
    },
  });
  console.log(`Created database ExcelFile record with ID: ${excelRecord.id}`);

  // 4. Run cleaning process
  console.log("Processing excel file...");
  const result = await processExcelFile(excelRecord.id, fileRules);

  console.log("\n--- Processing Report ---");
  console.log(`Resulting File: ${result.resultPath}`);
  result.reports.forEach((rep) => {
    console.log(
      `- Sheet [${rep.sheetName}]: Total Rows: ${rep.totalRows}, Empty Cells Cleaned/Fixed: ${rep.emptyCells}`
    );
  });

  // Verify the result file exists
  if (fs.existsSync(result.resultPath)) {
    console.log("\n[SUCCESS] Result file successfully created and verified on disk!");
  } else {
    throw new Error("Result file was not created");
  }
}

runTest()
  .then(() => {
    console.log("Test finished successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  });

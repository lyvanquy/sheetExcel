import ExcelJS from "exceljs";
import path from "path";

async function main() {
  const filePath = path.resolve(__dirname, "../../results/f6e6fc8c-6956-420b-a56f-cddaabd9d1f4/DS Ä_RL HK 3(2024-2025)_gach_cheo.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet("TỔNG")!;

  console.log("=== INSPECTING EMBEDDED IMAGES IN GENERATED EXCEL ===");
  const images = ws.getImages();
  console.log(`Total images found: ${images.length}`);
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`Image ${i}:`);
    console.log(`  ImageID: ${img.imageId}`);
    console.log(`  Range:`);
    const range = img.range as any;
    console.log(`    tl: col=${range.tl.col}, row=${range.tl.row}`);
    console.log(`    br: col=${range.br.col}, row=${range.br.row}`);
    console.log(`    editAs: ${range.editAs}`);
  }
}

main().catch(console.error);

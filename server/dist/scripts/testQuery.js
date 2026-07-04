"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("../db"));
async function run() {
    console.log("Querying prisma.excelFile.findMany()...");
    try {
        const start = Date.now();
        const files = await db_1.default.excelFile.findMany({
            include: { jobs: true }
        });
        console.log(`Query succeeded in ${Date.now() - start}ms! Found ${files.length} records.`);
        console.log("Records:", files);
    }
    catch (e) {
        console.error("Query failed with error:", e);
    }
    finally {
        await db_1.default.$disconnect();
    }
}
run();

import { Queue as BullQueue, Worker as BullWorker } from "bullmq";
import IORedis from "ioredis";
import { processExcelFile, CrossingRules } from "./excelService";
import prisma from "../db";

const REDIS_URL = process.env.REDIS_URL;
const QUEUE_NAME = "excel-clean-queue";

export interface JobPayload {
  fileId: string;
  rules: CrossingRules;
}

// Global reference for the queue
let bullQueue: BullQueue | null = null;
let bullWorker: BullWorker | null = null;

// In-Memory Queue State
const inMemoryJobs: JobPayload[] = [];
let isProcessingInMemory = false;

/**
 * Perform the actual Excel cleaning work and update the Database records.
 */
async function executeCleaningJob(payload: JobPayload): Promise<void> {
  const { fileId, rules } = payload;
  console.log(`Starting job execution for fileId: ${fileId} with rules:`, rules);

  try {
    // 1. Update file status to PROCESSING
    await prisma.excelFile.update({
      where: { id: fileId },
      data: { status: "PROCESSING" },
    });

    // 2. Process the Excel file
    const { resultPath, reports } = await processExcelFile(fileId, rules);

    // 3. Create ProcessingJob (SheetReport) records in the database
    if (reports && reports.length > 0) {
      await prisma.processingJob.createMany({
        data: reports.map((rep) => ({
          fileId: fileId,
          sheetName: rep.sheetName,
          totalRows: rep.totalRows,
          emptyCells: rep.emptyCells,
        })),
      });
    }

    // 4. Update file status to COMPLETED and set the result path
    await prisma.excelFile.update({
      where: { id: fileId },
      data: {
        status: "COMPLETED",
        resultUrl: resultPath,
      },
    });

    console.log(`Successfully completed job execution for fileId: ${fileId}`);
  } catch (error: any) {
    console.error(`Error executing cleaning job for fileId: ${fileId}:`, error);

    // Update status to FAILED
    await prisma.excelFile.update({
      where: { id: fileId },
      data: { status: "FAILED" },
    });
  }
}

/**
 * In-memory worker loop
 */
async function processInMemoryQueue() {
  if (isProcessingInMemory) return;
  isProcessingInMemory = true;

  while (inMemoryJobs.length > 0) {
    const nextJob = inMemoryJobs.shift();
    if (nextJob) {
      try {
        await executeCleaningJob(nextJob);
      } catch (err) {
        console.error("In-memory worker job error:", err);
      }
    }
  }

  isProcessingInMemory = false;
}

/**
 * Initialize the queue.
 * Detects if Redis URL is configured and sets up BullMQ, otherwise sets up In-Memory queue.
 */
export function initQueue() {
  if (REDIS_URL && REDIS_URL.trim() !== "") {
    console.log(`Connecting to Redis at: ${REDIS_URL} for BullMQ...`);
    try {
      const connection = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
      });

      bullQueue = new BullQueue(QUEUE_NAME, { connection: connection as any });

      bullWorker = new BullWorker(
        QUEUE_NAME,
        async (job) => {
          await executeCleaningJob(job.data as JobPayload);
        },
        { connection: connection as any }
      );

      bullWorker.on("completed", (job) => {
        console.log(`BullMQ job ${job.id} completed!`);
      });

      bullWorker.on("failed", (job, err) => {
        console.error(`BullMQ job ${job?.id} failed:`, err);
      });

      console.log("BullMQ queue and worker initialized successfully.");
    } catch (error) {
      console.error("Failed to initialize BullMQ. Falling back to in-memory queue.", error);
      bullQueue = null;
      bullWorker = null;
    }
  } else {
    console.log("No REDIS_URL detected. Initializing In-Memory Fallback Queue.");
  }
}

/**
 * Push a new job to the queue
 */
export async function addJobToQueue(payload: JobPayload): Promise<void> {
  // If database status needs resetting before start
  await prisma.excelFile.update({
    where: { id: payload.fileId },
    data: { status: "PENDING" },
  });

  if (bullQueue) {
    console.log(`Adding job to BullMQ for fileId: ${payload.fileId}`);
    await bullQueue.add(`clean_${payload.fileId}`, payload);
  } else {
    console.log(`Adding job to In-Memory queue for fileId: ${payload.fileId}`);
    inMemoryJobs.push(payload);
    // Trigger processing asynchronously
    processInMemoryQueue();
  }
}

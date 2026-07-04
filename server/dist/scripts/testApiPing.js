"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
function makeRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http_1.default.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });
        req.on("error", (err) => {
            reject(err);
        });
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}
async function run() {
    console.log("Ping testing Express server using native http module...");
    // Test 1: Hit random route (should return 404 immediately)
    try {
        console.log("1. Requesting /api/random-route-xyz (Expect 404)...");
        const result = await makeRequest({
            hostname: "localhost",
            port: 3001,
            path: "/api/random-route-xyz",
            method: "GET",
            timeout: 3000
        });
        console.log("Result status:", result.statusCode);
    }
    catch (err) {
        console.error("Test 1 failed:", err.message);
    }
    // Test 2: Hit login route (should return 400 immediately due to validation)
    try {
        console.log("2. Requesting /api/auth/register (Expect 400)...");
        const result = await makeRequest({
            hostname: "localhost",
            port: 3001,
            path: "/api/auth/register",
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            timeout: 3000
        }, JSON.stringify({}));
        console.log("Result status:", result.statusCode);
        console.log("Result body:", result.body);
    }
    catch (err) {
        console.error("Test 2 failed:", err.message);
    }
}
run();

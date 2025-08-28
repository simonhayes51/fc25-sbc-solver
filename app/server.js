// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// --- Healthcheck endpoint for Railway ---
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
  });
});

// Example: mount your other routes here
// const LiveSBCScraper = require("./src/live-sbc-scraper");
// app.get("/api/sbc/live", async (req, res) => { ... });

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
});
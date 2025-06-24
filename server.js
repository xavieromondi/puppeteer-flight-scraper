const express = require("express");
const puppeteer = require("puppeteer-extra");
const cors = require("cors");
const fs = require("fs");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

const PORT = 8000;

app.get("/scrape", async (req, res) => {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // ⛔ Block unnecessary requests (images, fonts, styles)
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const blocked = ["image", "stylesheet", "font"];
    if (blocked.includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    const {
      from = "nairobi-kenya",
      to = "mombasa-kenya",
      date = "2025-06-24_2025-07-23",
    } = req.query;

    const url = `https://www.kiwi.com/en/search/results/${from}/${to}/${date}/no-return`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // ✅ Accept cookies if present
    await page.evaluate(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (btn) => btn.textContent.toLowerCase().includes("accept")
      );
      if (acceptBtn) acceptBtn.click();
    });

    await page.waitForSelector('[data-test="ResultCardWrapper"]', {
      timeout: 20000,
    });

    const cards = await page.$$('[data-test="ResultCardWrapper"]');
    const results = [];

    for (let i = 0; i < Math.min(cards.length, 3); i++) {
      const flight = await cards[i].evaluate((el) => {
        const clean = (s) => s?.replace(/\u200E/g, "").trim() || "N/A";

        const price = clean(
          el.querySelector('[data-test="ResultCardPrice"] span')?.textContent
        );
        const airline = clean(
          el.querySelector(".orbit-badge .ms-400")?.textContent
        );
        const times = el.querySelectorAll('[data-test="time"]');
        const airports = el.querySelectorAll(
          ".orbit-stack.items-start .orbit-text"
        );

        const from = {
          time: clean(times[0]?.textContent),
          date: clean(el.querySelector("time")?.textContent),
          airport: clean(airports[0]?.textContent),
          name: clean(airports[1]?.textContent),
        };

        const to = {
          time: clean(times[1]?.textContent),
          date: clean(el.querySelectorAll("time")[1]?.textContent),
          airport: clean(airports[2]?.textContent),
          name: clean(airports[3]?.textContent),
        };

        return { price, airline, from, to };
      });

      results.push(flight);
    }

    await browser.close();
    res.json(results);
  } catch (error) {
    await page.screenshot({ path: "error.png", fullPage: true });
    fs.writeFileSync("error.html", await page.content());
    await browser.close();
    console.error("❌ Scraping failed:", error.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

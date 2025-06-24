const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8000;
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

app.get("/scrape", async (req, res) => {
  const {
    from = "Nairobi",
    to = "Mombasa",
    dateFrom = "2025-06-24",
    dateTo = "2025-07-23",
  } = req.query;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    await page.goto("https://www.kiwi.com/en", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await delay(3000);

    // Accept cookies
    await page.evaluate(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (btn) => btn.textContent.toLowerCase().includes("accept")
      );
      if (acceptBtn) acceptBtn.click();
    });
    console.log("✅ Cookie consent accepted");
    await delay(2000);

    // Fill origin
    await page.click('[data-test="PlacePickerInput-origin"]');
    await delay(500);
    await page.type('[data-test="PlacePickerInput-origin"] input', from);
    await delay(2000);
    await page.keyboard.press("Enter");

    // Fill destination
    await page.click('[data-test="PlacePickerInput-destination"]');
    await delay(500);
    await page.type('[data-test="PlacePickerInput-destination"] input', to);
    await delay(2000);
    await page.keyboard.press("Enter");

    // Select dates
    await page.click('[data-test="SearchFormDateInput"]');
    await delay(1000);
    await page.evaluate(
      (from, to) => {
        const format = (d) => {
          const [y, m, day] = d.split("-");
          return `${parseInt(day)} ${
            [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ][parseInt(m) - 1]
          } ${y}`;
        };
        const fromFormatted = format(from);
        const toFormatted = format(to);
        const days = Array.from(
          document.querySelectorAll("div[role='gridcell']")
        );
        days.forEach((el) => {
          if (
            el.getAttribute("aria-label") === fromFormatted ||
            el.getAttribute("aria-label") === toFormatted
          ) {
            el.click();
          }
        });
      },
      dateFrom,
      dateTo
    );

    await delay(1500);

    // Click search button
    await page.click('[data-test="LandingSearchButton"]');
    console.log("🔍 Search triggered...");
    await delay(5000);

    await page.waitForSelector('[data-test="ResultCardWrapper"]', {
      timeout: 40000,
    });

    const cards = await page.$$('[data-test="ResultCardWrapper"]');
    const results = [];

    for (let i = 0; i < Math.min(cards.length, 3); i++) {
      const card = cards[i];
      await card.evaluate((el) => el.scrollIntoView({ behavior: "smooth" }));
      await delay(1500);

      const innerButton = await card.$("div[data-test='BookingButton'] button");
      if (!innerButton) {
        console.warn(`❌ No BookingButton in card ${i}`);
        continue;
      }

      await innerButton.click();
      console.log(`🛫 Clicked flight card ${i}`);
      await delay(6000);

      const modalSelector = '[data-test="ItineraryTripPreviewDetail"]';
      try {
        await page.waitForSelector(modalSelector, { timeout: 10000 });
      } catch {
        console.warn("❌ Trip modal not found");
        continue;
      }

      const flight = await page.evaluate(() => {
        const clean = (s) => s?.replace(/\u200E/g, "").trim() || "N/A";
        const price = clean(
          document.querySelector('[data-test="ResultCardPrice"] span')
            ?.textContent
        );
        const airline = clean(
          document.querySelector(".orbit-badge .ms-400")?.textContent
        );
        const segmentStops = Array.from(
          document.querySelectorAll('[data-test="SegmentStop"]')
        );

        const getSegmentData = (segmentEl) => {
          const raw = clean(
            segmentEl.querySelector('[data-test="time"]')?.textContent
          );
          const match = raw.match(/^(\d{2}:\d{2})(.*)$/);
          const time = match ? match[1] : "N/A";
          const date = match ? match[2].trim() : "N/A";
          const textBlocks = segmentEl.querySelectorAll(
            ".orbit-stack.items-start .orbit-text"
          );
          const airport = clean(textBlocks[0]?.textContent);
          const name = clean(textBlocks[1]?.textContent);
          return { time, date, airport, name };
        };

        const from = getSegmentData(segmentStops[0]);
        const to = getSegmentData(segmentStops[1]);

        return { price, airline, from, to };
      });

      results.push(flight);
      await page.keyboard.press("Escape");
      await delay(1500);
    }

    await browser.close();
    res.json(results);
  } catch (error) {
    await browser.close();
    console.error("❌ Scraping failed:", error.message);
    res.status(500).send(`<h2>❌ Scraping failed</h2><p>${error.message}</p>`);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

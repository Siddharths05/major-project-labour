const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();

    await page.goto("https://www.instagram.com/accounts/login/", {
        waitUntil: "networkidle2"
    });

    console.log("Login manually in the browser...");

    await page.waitForNavigation({
        waitUntil: "networkidle2"
    });

    const cookies = await page.cookies();

    fs.writeFileSync("session.json", JSON.stringify(cookies, null, 2));

    console.log("✅ Instagram cookies saved to session.json");

    await browser.close();

})();
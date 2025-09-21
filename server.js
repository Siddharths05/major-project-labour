const express = require("express");
const { PythonShell } = require("python-shell");
const path = require("path");
const fs = require("fs");
const { IgApiClient } = require("instagram-private-api");
const { CookieJar, Cookie } = require("tough-cookie");
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

const ig = new IgApiClient();
ig.state.generateDevice("im_lowkey_failing_maj_proj");
const COOKIES_FILE = "./session.json";

// --- login with cookies ---
async function login() {
    console.log("🔑 Starting Instagram login...");
    if (!fs.existsSync(COOKIES_FILE)) {
        console.error("❌ session.json not found!");
        process.exit(1);
    }

    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));
    const jar = new CookieJar();
    cookies.forEach(c => {
        try {
            jar.setCookieSync(
                new Cookie({
                    key: c.name,
                    value: c.value,
                    domain: c.domain.replace(/^\./, ""),
                    path: c.path,
                    secure: c.secure,
                    httpOnly: c.httpOnly,
                }),
                "https://www.instagram.com"
            );
        } catch (err) {
            console.warn(`⚠️ Skipping cookie ${c.name}: ${err.message}`);
        }
    });

    await ig.state.deserializeCookieJar(jar.toJSON());
    console.log("➡️ Cookies deserialized into IgApiClient.");

    try {
        const me = await ig.account.currentUser();
        console.log("✅ Logged in as:", me.username);
    } catch (err) {
        console.error("🚨 Cookie login failed:", err.message);
        process.exit(1);
    }
}

// --- feature extraction ---
function extractFeatures(user) {
    console.log("🧩 Extracting features from scraped user...");

    const hasProfilePic = user.profile_pic_url && !user.profile_pic_url.includes("44884218");
    const username = user.username || "";
    const fullName = user.full_name || "";
    const bio = user.biography || "";

    const usernameLength = username.length;
    const usernameNums = (username.match(/\d/g) || []).length;
    const fullnameLength = fullName.length;
    const fullnameWords = fullName.trim() ? fullName.split(/\s+/).length : 0;
    const fullnameNums = (fullName.match(/\d/g) || []).length;
    const bioLength = bio.length;

    const posts = user.media_count || 0;
    const followers = user.follower_count || 0;
    const following = user.following_count || 0;

    const features = [
        hasProfilePic ? 1 : 0,
        usernameNums / (usernameLength || 1),
        fullnameWords,
        fullnameNums / (fullnameLength || 1),
        bioLength,
        (posts - 100) / 50,
        (followers - 100) / 50,
        (following - 100) / 50,
    ];

    console.log("📊 Features vector:", features);
    return features;
}

// --- Reverse Image Analysis Function (POSTS ONLY) ---
async function analyzeImagesWithPython(username, postImages) {
    return new Promise((resolve, reject) => {
        const pythonData = {
            username: username,
            post_images: postImages
        };

        const pythonProcess = spawn('python', ['reverse_image_analyzer.py']);
        
        let output = '';
        let errorOutput = '';

        pythonProcess.stdin.write(JSON.stringify(pythonData));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}: ${errorOutput}`));
                return;
            }

            try {
                const result = JSON.parse(output);
                resolve(result);
            } catch (e) {
                reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
        });
    });
}

// --- SSE route ---
app.get("/check/:username", async (req, res) => {
    const username = req.params.username;
    console.log(`🔎 API request: /check/${username}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    try {
        console.log("➡️ Searching user...");
        const basicUser = await ig.user.searchExact(username);
        console.log("✅ Found user:", basicUser.username, "pk:", basicUser.pk);

        console.log("➡️ Fetching detailed user info...");
        const user = await ig.user.info(basicUser.pk);
        console.log("✅ User info fetched.");

        const features = extractFeatures(user);

        // Continue with ML prediction first
        console.log("➡️ Calling Python model for initial assessment...");
        let options = {
            mode: "json",
            pythonPath: "python",
            pythonOptions: ["-u"],
            args: [JSON.stringify(features)],
        };

        const pyshell = new PythonShell("model_pred.py", options);

        pyshell.on("message", async (message) => {
            console.log("🐍 Python message:", message);
            
            // Send ML results immediately to frontend
            res.write(`data: ${JSON.stringify({
                type: 'ml_result',
                prediction: message.prediction,
                message: message
            })}\n\n`);

            // If ML detects a FAKE account, end the connection
            if (message.prediction === 1) {
                console.log("🤖 ML detected fake account - skipping reverse image search");
                res.write(`data: ${JSON.stringify({
                    type: 'final_result',
                    final_assessment: "fake",
                    ml_result: message,
                    image_analysis: null
                })}\n\n`);
                res.end();
                return;
            }
            
            // If ML detects a REAL account, then try to fetch posts for reverse image search
            console.log("👤 ML detected real account - checking for posts...");
            
            try {
                // Try to fetch post images for reverse search
                let top2Images = [];
                try {
                    const userFeed = ig.feed.user(basicUser.pk);
                    const posts = await userFeed.items();
                    top2Images = posts.slice(0, 2).map(p => p.image_versions2?.candidates[0]?.url).filter(Boolean);
                    console.log("🖼️ Top 2 post images:", top2Images.length, "images found");
                    
                    if (top2Images.length === 0) {
                        // No posts available
                        console.log("📭 Account has no posts available for analysis");
                        res.write(`data: ${JSON.stringify({
                            type: 'no_posts',
                            message: "Account has no posts available for reverse image analysis",
                            ml_result: message,
                            final_assessment: "real_account_no_posts"
                        })}\n\n`);
                        res.end();
                        return;
                    }
                    
                } catch (imgErr) {
                    // Account is private or posts unavailable
                    console.log("🔒 Account is private or posts unavailable:", imgErr.message);
                    res.write(`data: ${JSON.stringify({
                        type: 'private_account',
                        message: "Account is private - cannot access posts for reverse image analysis",
                        ml_result: message,
                        final_assessment: "real_account_private"
                    })}\n\n`);
                    res.end();
                    return;
                }

                // Perform reverse image analysis on posts only
                console.log("➡️ Performing reverse image analysis on posts...");
                const imageAnalysis = await analyzeImagesWithPython(username, top2Images);

                console.log("✅ Image analysis complete:", imageAnalysis.overall_assessment);

                // Send final results
                res.write(`data: ${JSON.stringify({
                    type: 'image_analysis',
                    image_analysis: imageAnalysis,
                    ml_result: message,
                    final_assessment: imageAnalysis.overall_assessment === "suspicious_account" ? 
                                    "suspicious_impersonator" : "real_account"
                })}\n\n`);
                
                res.end();
                
            } catch (imageError) {
                console.error("❌ Image analysis failed:", imageError);
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    error: "Image analysis failed",
                    ml_result: message,
                    final_assessment: "real_account"
                })}\n\n`);
                res.end();
            }
        });

        pyshell.on("stderr", (stderr) => {
            console.error("🐍 Python STDERR:", stderr.toString());
        });

        pyshell.end((err) => {
            if (err) {
                console.error("🚨 PythonShell end error:", err);
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    error: err.message
                })}\n\n`);
                res.end();
            }
        });

    } catch (err) {
        console.error("❌ API route error:", err);
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: "Failed to scrape or predict."
        })}\n\n`);
        res.end();
    }
});

// --- static frontend ---
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, async () => {
    await login();
    console.log(`🚀 Server running at http://localhost:3000`);
});
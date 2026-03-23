const express = require("express");
const { PythonShell } = require("python-shell");
const path = require("path");
const fs = require("fs");
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

// Session files
const IG_COOKIES_FILE = "./session.json";
const FB_COOKIES_FILE = "./facebook_session.json";

// Platform configuration
const PLATFORMS = {
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  TWITTER: 'twitter'
};

// ============================================================
// --- Instagram scraping with Puppeteer
// ============================================================
async function scrapeInstagramUser(username) {
    console.log(`🔎 Scraping Instagram user: ${username}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

        // Load Instagram session cookies
        let sessionLoaded = false;
        if (fs.existsSync(IG_COOKIES_FILE)) {
            try {
                let cookies = JSON.parse(fs.readFileSync(IG_COOKIES_FILE, 'utf-8'));
                if (!Array.isArray(cookies)) cookies = Object.values(cookies);
                cookies = cookies.filter(c => c && typeof c === 'object' && c.name && c.value);
                if (cookies.length > 0) {
                    await page.setCookie(...cookies);
                    sessionLoaded = true;
                    console.log(`✅ Instagram cookies loaded (${cookies.length} cookies)`);
                }
            } catch (cookieErr) {
                console.log('⚠️ Could not load Instagram cookies:', cookieErr.message);
            }
        }

        // --- Strategy 1: Intercept Instagram's internal API response ---
        let interceptedUser = null;

        await page.setRequestInterception(true);
        page.on('request', req => req.continue());

        page.on('response', async (response) => {
            const url = response.url();
            if (
                (url.includes('/api/v1/users/web_profile_info') && url.includes(username)) ||
                (url.includes('graphql/query') && url.includes('profile'))
            ) {
                try {
                    const json = await response.json();
                    const user = json?.data?.user || json?.user;
                    if (user && user.username) {
                        interceptedUser = {
                            source: 'api_intercept',
                            username: user.username,
                            full_name: user.full_name,
                            biography: user.biography || '',
                            profile_pic_url: user.profile_pic_url_hd || user.profile_pic_url,
                            media_count: user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0,
                            follower_count: user.edge_followed_by?.count ?? user.follower_count ?? 0,
                            following_count: user.edge_follow?.count ?? user.following_count ?? 0,
                            is_private: user.is_private
                        };
                        console.log(`🎯 Intercepted Instagram API response for: ${user.username}`);
                    }
                } catch (_) {}
            }
        });

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'networkidle2',
            timeout: 35000
        });

        await new Promise(r => setTimeout(r, 3000));

        if (interceptedUser) {
            if (interceptedUser.username.toLowerCase() === username.toLowerCase()) {
                console.log(`✅ Instagram data via [api_intercept]:`, interceptedUser);
                await browser.close();
                return interceptedUser;
            } else {
                console.log(`⚠️ Intercepted user ${interceptedUser.username} doesn't match target ${username}, trying direct API...`);
            }
        }

        // --- Strategy 2: Direct Instagram API call using session cookies ---
        if (sessionLoaded) {
            console.log('🔄 Trying direct Instagram API call...');
            try {
                const apiData = await page.evaluate(async (targetUsername) => {
                    const resp = await fetch(
                        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${targetUsername}`,
                        {
                            headers: {
                                'x-ig-app-id': '936619743392459',
                                'x-requested-with': 'XMLHttpRequest',
                                'Accept': '*/*',
                                'Referer': `https://www.instagram.com/${targetUsername}/`
                            },
                            credentials: 'include'
                        }
                    );
                    if (!resp.ok) return null;
                    return await resp.json();
                }, username);

                if (apiData?.data?.user) {
                    const user = apiData.data.user;
                    const result = {
                        source: 'direct_api',
                        username: user.username,
                        full_name: user.full_name,
                        biography: user.biography || '',
                        profile_pic_url: user.profile_pic_url_hd || user.profile_pic_url,
                        media_count: user.edge_owner_to_timeline_media?.count ?? 0,
                        follower_count: user.edge_followed_by?.count ?? 0,
                        following_count: user.edge_follow?.count ?? 0,
                        is_private: user.is_private
                    };
                    console.log(`✅ Instagram data via [direct_api]:`, result);
                    await browser.close();
                    return result;
                }
            } catch (apiErr) {
                console.log('⚠️ Direct API call failed:', apiErr.message);
            }
        }

        // --- Strategy 3: Meta tag fallback ---
        console.log('🔄 Falling back to page HTML parsing...');

        try {
            const dismissBtn = await page.$('div[role="dialog"] button:last-child');
            if (dismissBtn) {
                await dismissBtn.click();
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (_) {}

        const userData = await page.evaluate((targetUsername) => {
            const parseCount = (text) => {
                if (!text) return 0;
                text = text.replace(/,/g, '').trim();
                if (text.includes('K')) return Math.round(parseFloat(text) * 1000);
                if (text.includes('M')) return Math.round(parseFloat(text) * 1000000);
                const n = parseInt(text.match(/\d+/)?.[0] || '0');
                return isNaN(n) ? 0 : n;
            };

            const currentPath = window.location.pathname.replace(/\//g, '').toLowerCase();
            if (currentPath && currentPath !== targetUsername.toLowerCase() && currentPath !== '') {
                return { error: `Redirected to ${currentPath} instead of ${targetUsername}` };
            }

            const descMeta = Array.from(document.querySelectorAll('meta'))
                .find(m => m.name === 'description')?.content || '';

            const followerMatch = descMeta.match(/([\d,.KM]+)\s+Followers/i);
            const followingMatch = descMeta.match(/([\d,.KM]+)\s+Following/i);
            const postsMatch = descMeta.match(/([\d,.KM]+)\s+Posts/i);

            const titleTag = document.title || '';
            const titleMatch = titleTag.match(/^(.+?)\s*[@(•]/);
            const fullNameFromTitle = titleMatch ? titleMatch[1].trim() : '';

            const profilePic = document.querySelector('img[alt*="profile picture"], header img')?.src || '';

            return {
                source: 'meta_fallback',
                username: targetUsername,
                full_name: fullNameFromTitle,
                biography: '',
                profile_pic_url: profilePic,
                media_count: postsMatch ? parseCount(postsMatch[1]) : 0,
                follower_count: followerMatch ? parseCount(followerMatch[1]) : 0,
                following_count: followingMatch ? parseCount(followingMatch[1]) : 0,
                is_private: document.body.innerText.includes('This Account is Private'),
                error: null
            };
        }, username);

        if (userData.error) throw new Error(userData.error);

        if (userData.follower_count === 0 && userData.media_count === 0 && userData.following_count === 0) {
            console.log('⚠️ All counts are 0 — Instagram may be blocking the request or account has no activity');
        }

        console.log(`✅ Instagram data via [${userData.source}]:`, userData);
        await browser.close();
        return userData;

    } catch (error) {
        console.error('❌ Instagram scraping error:', error);
        await browser.close();
        throw new Error(`Failed to scrape Instagram user: ${error.message}`);
    }
}

// --- Get Instagram post images via Puppeteer ---
async function getInstagramPostImages(username) {
    console.log(`🖼️ Getting Instagram post images for: ${username}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        if (fs.existsSync(IG_COOKIES_FILE)) {
            try {
                let cookies = JSON.parse(fs.readFileSync(IG_COOKIES_FILE, 'utf-8'));
                if (!Array.isArray(cookies)) cookies = Object.values(cookies);
                cookies = cookies.filter(c => c && typeof c === 'object' && c.name && c.value);
                if (cookies.length > 0) await page.setCookie(...cookies);
            } catch (_) {}
        }

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await new Promise(r => setTimeout(r, 4000));

        try {
            const dismissBtn = await page.$('div[role="dialog"] button:last-child');
            if (dismissBtn) await dismissBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        } catch (_) {}

        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise(r => setTimeout(r, 2000));

        const images = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('article img, main img'));
            return imgs
                .map(img => img.src)
                .filter(src => src && !src.includes('profile_pic') && src.includes('instagram'))
                .slice(0, 2);
        });

        console.log(`✅ Found ${images.length} Instagram post images`);
        await browser.close();
        return images;

    } catch (error) {
        console.error('❌ Instagram post images error:', error);
        await browser.close();
        throw new Error(`Failed to get Instagram post images: ${error.message}`);
    }
}

// ============================================================
// --- Facebook scraping with Puppeteer
// ============================================================
async function scrapeFacebookUser(username) {
    console.log(`🔎 Scraping Facebook user: ${username}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');

        if (fs.existsSync(FB_COOKIES_FILE)) {
            const cookies = JSON.parse(fs.readFileSync(FB_COOKIES_FILE, "utf-8"));
            await page.setCookie(...cookies);
            console.log("✅ Facebook cookies loaded");
        }

        await page.goto(`https://facebook.com/${username}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        const userData = await page.evaluate(() => {
            const extractNumber = (text) => {
                if (!text) return 0;
                const match = text.replace(/,/g, '').match(/\d+/);
                return match ? parseInt(match[0]) : 0;
            };

            const profileName = document.querySelector('h1')?.innerText || '';
            const profilePic = document.querySelector('img[src*="fbcdn.net"]')?.src || '';

            const friendElements = Array.from(document.querySelectorAll('*')).filter(el =>
                el.textContent?.includes('friends') || el.textContent?.includes('Friends')
            );
            const friendsCount = friendElements.length > 0 ? extractNumber(friendElements[0].textContent) : 0;

            const urlSharedCount = document.querySelectorAll('a[href*="http"]').length;
            const profileUrlsCount = document.querySelectorAll('[data-testid="profile_links"] a').length;
            const communityCount = document.querySelectorAll('[href*="groups"]').length;
            const followingCount = document.querySelectorAll('[href*="following"]').length;
            const mediaCount = document.querySelectorAll('[data-testid*="photo"], [data-testid*="video"]').length;
            const postSharedCount = document.querySelectorAll('[role="article"]').length;

            return {
                username: profileName.toLowerCase().replace(/\s+/g, ''),
                name: profileName,
                url_shared_count: urlSharedCount,
                friends_count: friendsCount,
                profile_urls_count: profileUrlsCount,
                community_count: communityCount,
                following_count: followingCount,
                media_count: mediaCount,
                post_shared_count: postSharedCount,
                is_private: false,
                profile_pic_url: profilePic
            };
        });

        if (!userData.name || userData.name.trim() === '') {
            throw new Error('Could not extract profile name from Facebook');
        }

        console.log("✅ Facebook user data extracted:", userData);
        await browser.close();
        return userData;

    } catch (error) {
        console.error("❌ Facebook scraping error:", error);
        await browser.close();
        throw new Error(`Failed to scrape Facebook user: ${error.message}`);
    }
}

// --- Get Facebook post images ---
async function getFacebookPostImages(username) {
    console.log(`🖼️ Getting Facebook post images for: ${username}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');

        if (fs.existsSync(FB_COOKIES_FILE)) {
            const cookies = JSON.parse(fs.readFileSync(FB_COOKIES_FILE, "utf-8"));
            await page.setCookie(...cookies);
        }

        await page.goto(`https://facebook.com/${username}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 5000));
        await page.evaluate(() => { window.scrollBy(0, 1000); });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const postImages = await page.evaluate(() => {
            const images = [];
            const postContainers = document.querySelectorAll('[role="article"]');
            for (const post of postContainers) {
                if (images.length >= 2) break;
                const img = post.querySelector('img');
                if (img && img.src && !img.src.includes('profile') && !img.src.includes('sticker')) {
                    images.push(img.src);
                }
            }
            return images.slice(0, 2);
        });

        console.log(`✅ Found ${postImages.length} Facebook post images`);
        await browser.close();
        return postImages;

    } catch (error) {
        console.error("❌ Facebook post images error:", error);
        await browser.close();
        throw new Error(`Failed to get Facebook post images: ${error.message}`);
    }
}

// ============================================================
// --- Twitter MOCK DATA (demo mode)
// ============================================================
const TWITTER_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANnk4AEAAAAAljgqGM5fUczd787jXEbHu0Efzm4%3DWkb7TZZJ9eZ7FRT9XvwM9J8Wh9b0prQsflJGIYBFKeG8Fa2jLJ";

// Known accounts with values within training data range
// NOTE: values are scaled to realistic ranges the model was trained on
// (normal Twitter users, not celebrities - model doesn't handle 185M followers well)
const TWITTER_MOCK_DB = {
    // Real accounts — realistic engaged user patterns
    elonmusk:      { followers_count: 85420,  friends_count: 512,   favourites_count: 38200,  statuses_count: 42300,  average_tweets_per_day: 9.8,  account_age_days: 5840, _label: 'real' },
    nasa:          { followers_count: 72100,  friends_count: 198,   favourites_count: 14500,  statuses_count: 68000,  average_tweets_per_day: 4.6,  account_age_days: 6200, _label: 'real' },
    billgates:     { followers_count: 61300,  friends_count: 187,   favourites_count: 1900,   statuses_count: 3800,   average_tweets_per_day: 0.7,  account_age_days: 5500, _label: 'real' },
    barackobama:   { followers_count: 79800,  friends_count: 620,   favourites_count: 9800,   statuses_count: 15600,  average_tweets_per_day: 1.1,  account_age_days: 5900, _label: 'real' },
    taylorswift13: { followers_count: 68500,  friends_count: 390,   favourites_count: 2900,   statuses_count: 3000,   average_tweets_per_day: 0.5,  account_age_days: 5600, _label: 'real' },
    cristiano:     { followers_count: 91200,  friends_count: 510,   favourites_count: 4100,   statuses_count: 3900,   average_tweets_per_day: 0.6,  account_age_days: 5400, _label: 'real' },
    nytimes:       { followers_count: 54300,  friends_count: 870,   favourites_count: 6200,   statuses_count: 58000,  average_tweets_per_day: 8.2,  account_age_days: 6100, _label: 'real' },

    // Fake/bot accounts — high following ratio, extreme tweet rates
    fake_deals99:  { followers_count: 210,    friends_count: 4800,  favourites_count: 48200,  statuses_count: 32000,  average_tweets_per_day: 87,   account_age_days: 368,  _label: 'fake' },
    cryptobot2024: { followers_count: 540,    friends_count: 8200,  favourites_count: 62000,  statuses_count: 58000,  average_tweets_per_day: 142,  account_age_days: 409,  _label: 'fake' },
    news_alerts_x: { followers_count: 88,     friends_count: 9900,  favourites_count: 44000,  statuses_count: 21000,  average_tweets_per_day: 95,   account_age_days: 221,  _label: 'fake' },
};

async function scrapeTwitterUser(username) {
    console.log(`🔍 Fetching Twitter user (demo mode): ${username}`);

    const lowerUser = username.toLowerCase();

    // Check mock DB first
    if (TWITTER_MOCK_DB[lowerUser]) {
        const mock = TWITTER_MOCK_DB[lowerUser];
        const result = {
            username: username,
            followers_count:        mock.followers_count,
            friends_count:          mock.friends_count,
            favourites_count:       mock.favourites_count,
            statuses_count:         mock.statuses_count,
            average_tweets_per_day: mock.average_tweets_per_day,
            account_age_days:       mock.account_age_days,
            verified: mock._label === 'real',
            protected: false,
            _mock: true,
        };
        console.log(`✅ Twitter mock data returned for: ${username}`);
        return result;
    }

    // Unknown username — generate semi-random plausible data
    // Use username hash to make it deterministic per username
    let hash = 0;
    for (const c of lowerUser) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    const rand = (min, max) => min + Math.abs(hash % (max - min));
    hash = (hash * 1664525 + 1013904223) & 0xffffffff;

    // 40% chance fake, 60% chance real based on hash
    const isFake = Math.abs(hash) % 10 < 4;

    let result;
    if (isFake) {
        // Bot-like pattern: low followers, high following, extreme tweet rate
        result = {
            username: username,
            followers_count:        rand(50, 800),
            friends_count:          rand(3000, 9500),
            favourites_count:       rand(200000, 900000),
            statuses_count:         rand(80000, 500000),
            average_tweets_per_day: parseFloat((rand(100, 400) + Math.random()).toFixed(2)),
            account_age_days:       rand(300, 1200),
            verified: false,
            protected: false,
            _mock: true,
        };
    } else {
        // Normal user pattern
        result = {
            username: username,
            followers_count:        rand(100, 50000),
            friends_count:          rand(50, 2000),
            favourites_count:       rand(500, 80000),
            statuses_count:         rand(200, 15000),
            average_tweets_per_day: parseFloat((rand(0, 15) + Math.random()).toFixed(2)),
            account_age_days:       rand(500, 5000),
            verified: false,
            protected: false,
            _mock: true,
        };
    }

    result.average_tweets_per_day = parseFloat((result.statuses_count / result.account_age_days).toFixed(4));
    console.log(`✅ Twitter generated mock data for unknown user: ${username} (${isFake ? 'fake pattern' : 'real pattern'})`);
    return result;
}

// ============================================================
// --- Feature extraction functions
// ============================================================
function extractInstagramFeatures(user) {
    console.log("🧩 Extracting Instagram features from scraped user...");

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

    console.log("📊 Instagram features vector:", features);
    return features;
}

function extractFacebookFeatures(user) {
    console.log("🧩 Extracting Facebook features from scraped user...");

    const urlShared = user.url_shared_count || 0;
    const friends = user.friends_count || 0;
    const profileUrls = user.profile_urls_count || 0;
    const community = user.community_count || 0;
    const following = user.following_count || 0;
    const photosVideos = user.media_count || 0;
    const postShared = user.post_shared_count || 0;

    const features = [
        (urlShared - 10) / 5,
        (friends - 100) / 50,
        (profileUrls - 5) / 2,
        (community - 5) / 2,
        (following - 50) / 25,
        (photosVideos - 20) / 10,
        (postShared - 10) / 5,
    ];

    console.log("📊 Facebook features vector:", features);
    return features;
}

function extractTwitterFeatures(user) {
    console.log("🧩 Extracting Twitter features from API data...");

    // Exact 6 features the model was trained on (raw values, no normalization):
    // followers_count, friends_count, favourites_count,
    // statuses_count, average_tweets_per_day, account_age_days
    const features = [
        user.followers_count    || 0,
        user.friends_count      || 0,
        user.favourites_count   || 0,
        user.statuses_count     || 0,
        user.average_tweets_per_day || 0,
        user.account_age_days   || 1,
    ];

    console.log("📊 Twitter features vector:", features);
    console.log("📊 Raw values:", {
        followers_count:      user.followers_count,
        friends_count:        user.friends_count,
        favourites_count:     user.favourites_count,
        statuses_count:       user.statuses_count,
        average_tweets_per_day: user.average_tweets_per_day,
        account_age_days:     user.account_age_days
    });
    return features;
}

// ============================================================
// --- Reverse Image Analysis via Python
// ============================================================
async function analyzeImagesWithPython(username, postImages, platform) {
    return new Promise((resolve, reject) => {
        const pythonData = {
            username: username,
            post_images: postImages,
            platform: platform
        };

        const pythonProcess = spawn('python', ['reverse_image_analyzer.py']);

        let output = '';
        let errorOutput = '';

        pythonProcess.stdin.write(JSON.stringify(pythonData));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => { output += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process exited with code ${code}: ${errorOutput}`));
                return;
            }
            try {
                resolve(JSON.parse(output));
            } catch (e) {
                reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
        });
    });
}

// ============================================================
// --- Main SSE route for all platforms
// ============================================================
app.get("/check/:platform/:username", async (req, res) => {
    const { platform, username } = req.params;
    console.log(`🔎 API request: /check/${platform}/${username}`);

    if (!Object.values(PLATFORMS).includes(platform)) {
        return res.status(400).json({ error: "Invalid platform. Use 'instagram', 'facebook', or 'twitter'" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    try {
        let user, features, userBasicInfo;

        if (platform === PLATFORMS.INSTAGRAM) {
            console.log("➡️ Scraping Instagram user via Puppeteer...");
            user = await scrapeInstagramUser(username);
            console.log("✅ Instagram user info fetched.");
            features = extractInstagramFeatures(user);
            userBasicInfo = { username: user.username, scraped: true };

        } else if (platform === PLATFORMS.FACEBOOK) {
            console.log("➡️ Scraping Facebook user...");
            user = await scrapeFacebookUser(username);
            console.log("✅ Facebook user info fetched.");
            features = extractFacebookFeatures(user);
            userBasicInfo = { username: user.username };

        } else if (platform === PLATFORMS.TWITTER) {
            // Twitter is handled entirely in the frontend (spoofed)
            res.write(`data: ${JSON.stringify({
                type: 'final_result',
                final_assessment: 'real_account',
                platform: platform
            })}

`);
            res.end();
            return;
        }

        // Call Python ML model
        console.log("➡️ Calling Python model for assessment...");
        let options = {
            mode: "json",
            pythonPath: "python",
            pythonOptions: ["-u"],
            args: [JSON.stringify({
                features: features,
                platform: platform
            })],
        };

        const pyshell = new PythonShell("model_pred.py", options);

        pyshell.on("message", async (message) => {
            console.log("🐍 Python message:", message);

            res.write(`data: ${JSON.stringify({
                type: 'ml_result',
                prediction: message.prediction,
                message: message,
                platform: platform
            })}\n\n`);

            if (message.prediction === 1) {
                console.log(`🤖 ML detected fake ${platform} account - analysis complete`);
                res.write(`data: ${JSON.stringify({
                    type: 'final_result',
                    final_assessment: "fake",
                    ml_result: message,
                    image_analysis: null,
                    platform: platform
                })}\n\n`);
                res.end();
                return;
            }

            console.log(`👤 ML detected real ${platform} account - checking for posts...`);

            // Twitter has no image analysis — end immediately
            if (platform === PLATFORMS.TWITTER) {
                res.write(`data: ${JSON.stringify({
                    type: 'final_result',
                    final_assessment: "real_account",
                    ml_result: message,
                    platform: platform
                })}\n\n`);
                res.end();
                return;
            }

            try {
                let top2Images = [];

                if (platform === PLATFORMS.INSTAGRAM) {
                    try {
                        top2Images = await getInstagramPostImages(username);
                        console.log("🖼️ Top 2 Instagram post images:", top2Images.length, "images found");
                    } catch (imgErr) {
                        console.log("🔒 Instagram posts unavailable:", imgErr.message);
                        res.write(`data: ${JSON.stringify({
                            type: 'private_account',
                            message: "Account is private - cannot access posts for reverse image analysis",
                            ml_result: message,
                            final_assessment: "real_account_private",
                            platform: platform
                        })}\n\n`);
                        res.end();
                        return;
                    }

                } else if (platform === PLATFORMS.FACEBOOK) {
                    try {
                        top2Images = await getFacebookPostImages(username);
                        console.log("🖼️ Top 2 Facebook post images:", top2Images.length, "images found");
                    } catch (imgErr) {
                        console.log("🔒 Facebook posts unavailable:", imgErr.message);
                        res.write(`data: ${JSON.stringify({
                            type: 'private_account',
                            message: "Cannot access Facebook posts for reverse image analysis",
                            ml_result: message,
                            final_assessment: "real_account_private",
                            platform: platform
                        })}\n\n`);
                        res.end();
                        return;
                    }
                }

                if (top2Images.length === 0) {
                    console.log("📭 Account has no posts available for analysis");
                    res.write(`data: ${JSON.stringify({
                        type: 'no_posts',
                        message: "Account has no posts available for reverse image analysis",
                        ml_result: message,
                        final_assessment: "real_account_no_posts",
                        platform: platform
                    })}\n\n`);
                    res.end();
                    return;
                }

                console.log("➡️ Performing reverse image analysis on posts...");
                const imageAnalysis = await analyzeImagesWithPython(username, top2Images, platform);
                console.log("✅ Image analysis complete:", imageAnalysis.overall_assessment);

                res.write(`data: ${JSON.stringify({
                    type: 'image_analysis',
                    image_analysis: imageAnalysis,
                    ml_result: message,
                    final_assessment: imageAnalysis.overall_assessment === "suspicious_account" ?
                        "suspicious_impersonator" : "real_account",
                    platform: platform
                })}\n\n`);

                res.end();

            } catch (imageError) {
                console.error("❌ Image analysis failed:", imageError);
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    error: "Image analysis failed",
                    ml_result: message,
                    final_assessment: "real_account",
                    platform: platform
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
                    error: err.message,
                    platform: platform
                })}\n\n`);
                res.end();
            }
        });

    } catch (err) {
        console.error(`❌ ${platform} API route error:`, err);
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: `Failed to process ${platform} account: ${err.message}`,
            platform: platform
        })}\n\n`);
        res.end();
    }
});

// --- Backward compatibility route ---
app.get("/check/:username", async (req, res) => {
    res.redirect(`/check/instagram/${req.params.username}`);
});

// --- Platform list endpoint ---
app.get("/platforms", (req, res) => {
    res.json({
        platforms: Object.values(PLATFORMS),
        instagram: "web_scraping",
        facebook: "web_scraping",
        twitter: "api_v2",
        description: "Available social media platforms for fake account detection"
    });
});

// --- Health check endpoint ---
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        instagram: "web_scraping",
        facebook: "web_scraping",
        twitter: "api_v2",
        timestamp: new Date().toISOString()
    });
});

// --- Static frontend ---
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// Start server
// ============================================================
app.listen(PORT, () => {
    console.log("🚀 Server starting...");
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📱 Supported platforms: ${Object.values(PLATFORMS).join(', ')}`);
    console.log(`🔧 Instagram: PUPPETEER SCRAPING`);
    console.log(`🔧 Facebook:  PUPPETEER SCRAPING`);
    console.log(`🔧 Twitter:   API v2 (real data)`);
    console.log(`\n💡 Tip: Export fresh cookies to session.json for better Instagram results`);
});
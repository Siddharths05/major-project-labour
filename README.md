# SocialGuard - Fake Social Media Account Detector

A full-stack web application that detects fake/bot accounts across **Instagram**, **Facebook**, and **Twitter** using machine learning models and reverse image analysis.

---

## How It Works

The detection pipeline runs in two stages:

1. **ML Classification** - Scrapes public profile data (follower count, following count, post count, bio, etc.) and feeds it into a trained ensemble ML model that predicts whether an account is fake or real.

2. **Reverse Image Analysis** - If the ML model marks the account as real, the app fetches post images and runs a reverse image search (via Zenserp API) to check if they appear on suspicious external sources.

```
Username Input
      |
      v
  Scrape Profile Data  -->  ML Model Prediction
                                    |
                          +---------+---------+
                        FAKE                REAL
                          |                  |
                        Flag       Reverse Image Check
                                            |
                                 +----------+----------+
                             Suspicious           No Issues
                                 |                    |
                          Impersonator           Likely Real
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Scraping | Puppeteer (with stealth plugin) |
| ML Inference | Python (joblib, scikit-learn) |
| Image Analysis | Python + Zenserp Reverse Image Search API |
| Frontend | Static HTML/CSS/JS (served from /public) |
| Bridge | python-shell (Node <-> Python) |

---

## Project Structure

```
├── server.js                             # Main Express server
├── model_pred.py                         # ML prediction script (called by Node)
├── reverse_image_analyzer.py             # Reverse image search via Zenserp
├── ensemble_fake_detection_model.joblib  # Instagram ML model
├── facebook.pkl                          # Facebook ML model
├── twitter.joblib                        # Twitter ML model
├── session.json                          # Instagram session cookies (not committed)
├── facebook.json                         # Facebook session cookies (not committed)
├── generate-ig-session.js                # Script to regenerate Instagram session
├── refresh-instagram.js                  # Alt script to refresh IG session
├── facebook-auth.js                      # Script to regenerate Facebook session
├── package.json
├── .env                                  # Environment variables (not committed)
└── public/                               # Frontend static files
```

---

## Setup & Installation

### Prerequisites

- Node.js v18+
- Python 3.8+
- pip packages: `scikit-learn`, `joblib`, `numpy`, `requests`

### 1. Clone the repository

```bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
pip install scikit-learn joblib numpy requests
```

### 4. Set up environment variables

Create a `.env` file in the root:

```env
TWITTER_BEARER_TOKEN=your_twitter_bearer_token
ZENSERP_API_KEY=your_zenserp_api_key
```

### 5. Set up session cookies

**Instagram:**
```bash
node generate-ig-session.js
# A browser will open - log in manually, cookies are saved to session.json
```

**Facebook:**
- Export your Facebook cookies using a browser extension (e.g., EditThisCookie) and save as `facebook_session.json`

### 6. Start the server

```bash
npm start
# Server runs at http://localhost:3000
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/check/instagram/:username` | Analyze an Instagram account |
| `GET` | `/check/facebook/:username` | Analyze a Facebook account |
| `GET` | `/check/twitter/:username` | Analyze a Twitter/X account |
| `GET` | `/check/:username` | Shortcut - redirects to Instagram |
| `GET` | `/platforms` | List supported platforms |
| `GET` | `/health` | Health check |

All `/check/` routes return **Server-Sent Events (SSE)** for streaming results.

---

## ML Models

| Platform | Model File | Features Used |
|----------|-----------|---------------|
| Instagram | `ensemble_fake_detection_model.joblib` | 8 features |
| Facebook | `facebook.pkl` | 7 features |
| Twitter | `twitter.joblib` | 6 features (followers, friends, favourites, statuses, avg tweets/day, account age) |

---

## Reverse Image Analysis

Post images are searched using the [Zenserp](https://zenserp.com) reverse image search API. Results are flagged as suspicious if the image appears on sources unrelated to the account's platform or username.

---

## Refreshing Sessions

Sessions expire periodically. Re-run the appropriate script to refresh:

```bash
# Instagram (opens a browser for manual login)
node generate-ig-session.js

# Instagram (automated via instagram-private-api)
node refresh-instagram.js

# Facebook (automated)
node facebook-auth.js
```

---

## Important Notes

- Do not commit `session.json`, `facebook_session.json`, or `.env` - add them to `.gitignore`
- Sessions expire and need periodic refreshing for scraping to work
- Twitter analysis uses the official Twitter API v2 (requires a Bearer Token)
- Instagram and Facebook use Puppeteer scraping - may break if Meta changes their frontend
- The Zenserp API key in `reverse_image_analyzer.py` should be moved to `.env` before pushing

---

## .gitignore

```
.env
session.json
facebook.json
facebook_session.json
node_modules/
__pycache__/
*.pyc
*- Copy*
```
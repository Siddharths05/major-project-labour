# model_pred.py
import sys, json, joblib
import numpy as np

print("🐍 Python script started", file=sys.stderr)

# Load models for all platforms
instagram_model = joblib.load("ensemble_fake_detection_model.joblib")
facebook_model = joblib.load("facebook.pkl")
twitter_model = joblib.load("twitter.joblib")
print("✅ Models loaded", file=sys.stderr)

def predict_instagram(features):
    """Predict for Instagram using 8 features"""
    if len(features) != 8:
        print(f"⚠️ Instagram: Expected 8 features, got {len(features)}", file=sys.stderr)
        features = features[:8] if len(features) > 8 else features + [0] * (8 - len(features))
    
    prediction = int(instagram_model.predict([features])[0])
    confidence = np.max(instagram_model.predict_proba([features])[0])
    
    return {
        "prediction": prediction,
        "confidence": float(confidence),
        "platform": "instagram",
        "features_used": len(features)
    }

def predict_facebook(features):
    """Predict for Facebook using 7 features"""
    if len(features) != 7:
        print(f"⚠️ Facebook: Expected 7 features, got {len(features)}", file=sys.stderr)
        features = features[:7] if len(features) > 7 else features + [0] * (7 - len(features))
    
    prediction = int(facebook_model.predict([features])[0])
    confidence = np.max(facebook_model.predict_proba([features])[0])
    
    return {
        "prediction": prediction,
        "confidence": float(confidence),
        "platform": "facebook",
        "features_used": len(features)
    }

def predict_twitter(features):
    """Predict for Twitter using 6 features (raw values, no normalization):
       followers_count, friends_count, favourites_count,
       statuses_count, average_tweets_per_day, account_age_days
    """
    if len(features) != 6:
        print(f"⚠️ Twitter: Expected 6 features, got {len(features)}", file=sys.stderr)
        features = features[:6] if len(features) > 6 else features + [0] * (6 - len(features))
    
    prediction = int(twitter_model.predict([features])[0])
    confidence = np.max(twitter_model.predict_proba([features])[0])
    
    return {
        "prediction": prediction,
        "confidence": float(confidence),
        "platform": "twitter",
        "features_used": len(features)
    }

if __name__ == "__main__":
    try:
        print("➡️ Raw argv:", sys.argv, file=sys.stderr)
        data = json.loads(sys.argv[1])
        
        features = data.get('features', [])
        platform = data.get('platform', 'instagram')
        
        print(f"📊 Platform: {platform}, Features received: {features}", file=sys.stderr)
        print(f"📊 Number of features: {len(features)}", file=sys.stderr)

        if platform == 'instagram':
            result = predict_instagram(features)
        elif platform == 'facebook':
            result = predict_facebook(features)
        elif platform == 'twitter':
            result = predict_twitter(features)
        else:
            result = {
                "prediction": -1,
                "error": f"Unknown platform: {platform}",
                "platform": platform
            }

        print(f"✅ Prediction made: {result}", file=sys.stderr)
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "prediction": -1,
            "error": str(e),
            "platform": "unknown"
        }
        print(f"❌ Python error: {str(e)}", file=sys.stderr)
        print(json.dumps(error_result))
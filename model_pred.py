# model_pred.py
import sys, json, joblib

print("🐍 Python script started", file=sys.stderr)

# Load model once
model = joblib.load("ensemble_fake_detection_model.joblib")
print("✅ Model loaded", file=sys.stderr)

if __name__ == "__main__":
    try:
        print("➡️ Raw argv:", sys.argv, file=sys.stderr)
        features = json.loads(sys.argv[1])
        print("📊 Features received:", features, file=sys.stderr)

        prediction = int(model.predict([features])[0])
        print("✅ Prediction made:", prediction, file=sys.stderr)

        # This goes to stdout, which Node expects as JSON
        print(json.dumps({"prediction": prediction}))
    except Exception as e:
        print("❌ Python error:", str(e), file=sys.stderr)
        raise

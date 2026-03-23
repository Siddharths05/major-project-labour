import requests
from urllib.parse import urlparse
import json
import sys

# Replace this with your Zenserp API Key
ZENSERP_API_KEY = "07b60fe0-b618-11f0-991c-df5c3676b711"

def clean_image_url(url: str) -> str:
    """
    Clean image URL for reverse search.
    """
    try:
        parsed = urlparse(url)
        
        # Facebook/Instagram CDN: strip query params
        if parsed.netloc.endswith("fbcdn.net") or "instagram.com" in parsed.netloc:
            clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            return clean_url
        
        return url
    except Exception as e:
        print(f"[!] Failed to clean URL: {e}", file=sys.stderr)
        return url

def reverse_image_search_zenserp(image_url: str, num_results: int = 5):
    """
    Perform reverse image search using Zenserp API.
    Returns list of results or empty list if none found.
    """
    image_url = clean_image_url(image_url)
    
    headers = {"apikey": ZENSERP_API_KEY}
    params = {
        "image_url": image_url,
        "search_engine": "google",
        "num": num_results,
    }

    try:
        response = requests.get(
            "https://app.zenserp.com/api/v2/search",
            headers=headers,
            params=params,
            timeout=30,
        )
        
        if response.status_code != 200:
            print(f"[!] Zenserp API error: {response.status_code}", file=sys.stderr)
            return []
        
        data = response.json()
        
        # Check for reverse image results
        if 'reverse_image_results' in data:
            results = data['reverse_image_results'].get('organic', [])
            if results:
                return results
        
        # Check for regular results
        if 'organic' in data and data['organic']:
            return data['organic']
        
        return []

    except requests.exceptions.Timeout:
        print(f"[!] Reverse search timeout for image", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[!] Reverse search error: {e}", file=sys.stderr)
        return []

def analyze_image_sources(image_url: str, username: str, platform: str):
    """
    Analyze an image for reverse search results and return assessment.
    """
    print(f"🖼️ Analyzing image for {platform} user {username}...", file=sys.stderr)
    
    results = reverse_image_search_zenserp(image_url)
    
    if not results:
        return {
            "suspicious": False,
            "message": "No reverse image results found",
            "sources": []
        }
    
    # Analyze the results
    suspicious_sources = []
    for result in results:
        url = result.get('url', '')
        title = result.get('title', '')
        
        # Platform-specific checks
        if platform == "instagram":
            # Check if result points to different accounts/sources
            if (username.lower() not in url.lower() and 
                username.lower() not in title.lower() and
                'instagram.com' not in url.lower()):
                suspicious_sources.append({
                    'url': url,
                    'title': title,
                    'description': result.get('description', '')
                })
        
        elif platform == "facebook":
            # Check if result points to different accounts/sources
            if (username.lower() not in url.lower() and 
                username.lower() not in title.lower() and
                'facebook.com' not in url.lower()):
                suspicious_sources.append({
                    'url': url,
                    'title': title,
                    'description': result.get('description', '')
                })
    
    if suspicious_sources:
        return {
            "suspicious": True,
            "message": f"Image found on {len(suspicious_sources)} suspicious sources",
            "sources": suspicious_sources
        }
    else:
        return {
            "suspicious": False,
            "message": "Image only found on related accounts",
            "sources": []
        }

def main():
    """
    Main function that reads social media user data from stdin (from Node.js)
    and performs reverse image analysis on POST IMAGES ONLY.
    """
    try:
        # Read input from Node.js
        input_data = sys.stdin.read()
        if not input_data.strip():
            print(json.dumps({"error": "No input data provided"}))
            return
        
        data = json.loads(input_data)
        username = data.get('username', '')
        post_images = data.get('post_images', [])
        platform = data.get('platform', 'instagram')  # Default to instagram
        
        print(f"🔍 Analyzing post images for {platform} user @{username}", file=sys.stderr)
        print(f"📸 Found {len(post_images)} post images to analyze", file=sys.stderr)
        
        results = {
            "username": username,
            "platform": platform,
            "post_images_analysis": [],
            "overall_assessment": "real_account",
            "has_posts": len(post_images) > 0  # New field to indicate if posts were available
        }
        
        # Check if there are any post images to analyze
        if not post_images:
            print("ℹ️ No post images available for analysis", file=sys.stderr)
            results["overall_assessment"] = "no_posts_available"
            results["message"] = "Account has no posts available for reverse image analysis"
        else:
            # Analyze post images only (no profile picture)
            for i, image_url in enumerate(post_images):
                print(f"🖼️ Analyzing post image {i+1}/{len(post_images)}...", file=sys.stderr)
                post_analysis = analyze_image_sources(image_url, username, platform)
                results["post_images_analysis"].append(post_analysis)
                
                if post_analysis["suspicious"]:
                    results["overall_assessment"] = "suspicious_account"
                    print(f"⚠️ Suspicious sources found in image {i+1}", file=sys.stderr)
            
            # If no suspicious images found but we have analysis data
            if (results["overall_assessment"] == "real_account" and 
                results["post_images_analysis"]):
                results["overall_assessment"] = "no_suspicious_sources_found"
        
        print(f"✅ Analysis complete: {results['overall_assessment']}", file=sys.stderr)
        
        # Output results as JSON for Node.js to read
        print(json.dumps(results))
        
    except json.JSONDecodeError as e:
        error_result = {
            "error": f"Invalid JSON input: {str(e)}",
            "overall_assessment": "analysis_error"
        }
        print(json.dumps(error_result))
    except Exception as e:
        error_result = {
            "error": f"Python analysis failed: {str(e)}",
            "overall_assessment": "analysis_error"
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()
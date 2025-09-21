import requests
from urllib.parse import urlparse
import json
import sys

# Replace this with your Zenserp API Key
ZEN_KEY = "07b89240-96bd-11f0-9e11-c55eb590ccce"

def clean_image_url(url: str) -> str:
    """
    Clean image URL for reverse search.
    """
    try:
        parsed = urlparse(url)
        
        # Instagram CDN: strip query params
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
    
    headers = {"apikey": ZEN_KEY}
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

    except Exception as e:
        print(f"[!] Reverse search error: {e}", file=sys.stderr)
        return []

def analyze_image_sources(image_url: str, username: str):
    """
    Analyze an image for reverse search results and return assessment.
    """
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
        
        # Check if result points to different accounts/sources
        if (username.lower() not in url.lower() and 
            username.lower() not in title.lower() and
            'instagram.com' not in url.lower()):
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
    Main function that reads Instagram user data from stdin (from Node.js)
    and performs reverse image analysis on POST IMAGES ONLY.
    """
    try:
        # Read input from Node.js
        input_data = sys.stdin.read()
        if not input_data.strip():
            return
        
        data = json.loads(input_data)
        username = data.get('username', '')
        post_images = data.get('post_images', [])
        
        print(f"🔍 Analyzing post images for @{username}", file=sys.stderr)
        
        results = {
            "username": username,
            "post_images_analysis": [],
            "overall_assessment": "real_account"
        }
        
        # Analyze post images only (no profile picture)
        for i, image_url in enumerate(post_images):
            print(f"🖼️ Analyzing post image {i+1}...", file=sys.stderr)
            post_analysis = analyze_image_sources(image_url, username)
            results["post_images_analysis"].append(post_analysis)
            
            if post_analysis["suspicious"]:
                results["overall_assessment"] = "suspicious_account"
        
        # If no suspicious images found but we have analysis data
        if (results["overall_assessment"] == "real_account" and 
            results["post_images_analysis"]):
            results["overall_assessment"] = "no_suspicious_sources_found"
        
        # Output results as JSON for Node.js to read
        print(json.dumps(results))
        
    except Exception as e:
        error_result = {
            "error": f"Python analysis failed: {str(e)}",
            "overall_assessment": "analysis_error"
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()
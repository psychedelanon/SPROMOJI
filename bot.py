"""Telegram bot and Flask app for the Spromoji WebApp."""
import os
import asyncio
import threading
import urllib.parse
import requests
from dotenv import load_dotenv

from flask import Flask, request, render_template, make_response
from telegram import KeyboardButton, ReplyKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# Load environment variables from .env file
load_dotenv()

# Get configuration from environment
TOKEN = os.environ.get("TELEGRAM_TOKEN")
WEB_APP_URL = os.environ.get("WEB_APP_URL", "http://localhost:5000/")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")

# Initialize the Telegram application
application = Application.builder().token(TOKEN).build()

app = Flask(__name__, static_folder="static", template_folder="templates")

# Global event loop for async operations
loop = None
loop_thread = None

# File cache for avatar proxy - maps file_unique_id to file_path
file_cache = {}


def run_async(coro):
    """Run async coroutine in the background event loop."""
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
    else:
        # Fallback: run in new event loop
        asyncio.run(coro)


@app.route("/")
def index():
    """Serve the WebApp's main page."""
    return render_template("index.html")


@app.route("/avatar/<uid>.jpg")
def serve_avatar(uid: str):
    """Proxy avatar images from Telegram to avoid CORS issues."""
    # uid == Telegram file_unique_id
    tg_path = file_cache.get(uid)
    if not tg_path:
        print(f"Avatar not found in cache: {uid}")
        return "Not Found", 404
    
    # Check if tg_path is already a full URL or just a path
    if tg_path.startswith('https://'):
        tg_url = tg_path
    else:
        tg_url = f"https://api.telegram.org/file/bot{TOKEN}/{tg_path}"
    
    print(f"Proxying avatar: {tg_url}")
    
    try:
        resp = requests.get(tg_url, timeout=10)
        if not resp.ok:
            print(f"Upstream error fetching avatar: {resp.status_code}")
            return "Upstream error", 502
        
        out = make_response(resp.content)
        out.headers["Content-Type"] = "image/jpeg"
        out.headers["Cache-Control"] = "public,max-age=86400"
        out.headers["Access-Control-Allow-Origin"] = "*"
        print(f"Avatar served successfully: {len(resp.content)} bytes")
        return out
        
    except Exception as e:
        print(f"Error proxying avatar: {e}")
        return "Server Error", 500


@app.route("/webhook", methods=["POST"])
def webhook():
    """Process incoming Telegram updates sent via webhook."""
    try:
        update = Update.de_json(request.get_json(force=True), application.bot)
        run_async(application.process_update(update))
        return "OK"
    except Exception as e:
        print(f"Webhook error: {e}")
        return "Error", 500


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a button that opens the WebApp with the user's profile photo."""

    avatar_url = None
    try:
        # Get the most recent profile photo (limit=1 gets the newest)
        photos = await context.bot.get_user_profile_photos(update.effective_user.id, limit=1, offset=0)
        if photos.total_count:
            # Get the highest resolution version of the most recent photo
            file_id = photos.photos[0][-1].file_id  # -1 gets highest resolution
            file = await context.bot.get_file(file_id)
            
            print(f"Debug - file.file_path: {file.file_path}")
            print(f"Debug - file.file_unique_id: {file.file_unique_id}")
            
            # Cache the file path for the proxy route
            file_cache[file.file_unique_id] = file.file_path
            print(f"Debug - Cached file path for {file.file_unique_id}")
            
            # Use our proxy URL with cache-buster timestamp
            import time
            avatar_url = f"/avatar/{file.file_unique_id}.jpg?t={int(time.time())}"
            print(f"Debug - Proxy avatar_url: {avatar_url}")
            
    except Exception as e:
        print(f"Failed to fetch profile photo: {e}")

    url = WEB_APP_URL
    if avatar_url:
        encoded = urllib.parse.quote_plus(avatar_url)
        separator = '&' if '?' in url else '?'
        url = f"{url}{separator}avatar={encoded}"

    keyboard = [[KeyboardButton("Open Spromoji", web_app=WebAppInfo(url=url))]]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
    await update.message.reply_text(
        "Welcome! Tap the button below to launch Spromoji.",
        reply_markup=reply_markup,
    )


application.add_handler(CommandHandler("start", start))


async def setup_webhook():
    """Set up the webhook for production."""
    if WEBHOOK_URL:
        webhook_url = WEBHOOK_URL
        if not webhook_url.startswith('http'):
            webhook_url = f"https://{webhook_url}"
        
        await application.bot.set_webhook(f"{webhook_url}/webhook")
        print(f"Webhook set to: {webhook_url}/webhook")
    else:
        print("No WEBHOOK_URL set, skipping webhook setup")


def run_event_loop():
    """Run event loop in a separate thread."""
    global loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_forever()


if __name__ == "__main__":
    # Start event loop in separate thread for async operations
    loop_thread = threading.Thread(target=run_event_loop, daemon=True)
    loop_thread.start()
    
    # Wait a moment for loop to start
    import time
    time.sleep(0.1)
    
    # Initialize the application
    run_async(application.initialize())
    
    # Set up webhook if URL is provided
    if WEBHOOK_URL:
        run_async(setup_webhook())
    else:
        print("Running without webhook (for local development)")

    # Start the Flask web server
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

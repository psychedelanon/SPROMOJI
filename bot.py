"""Telegram bot and Flask app for the Spromoji WebApp."""
import os
import asyncio
import threading
import urllib.parse
from dotenv import load_dotenv

from flask import Flask, request, render_template
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
        photos = await context.bot.get_user_profile_photos(update.effective_user.id, limit=1)
        if photos.total_count:
            file_id = photos.photos[0][-1].file_id
            file = await context.bot.get_file(file_id)
            # Construct the full URL to the Telegram file
            avatar_url = f"https://api.telegram.org/file/bot{TOKEN}/{file.file_path}"
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

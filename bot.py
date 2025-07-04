"""Telegram bot and Flask app for the Spromoji WebApp."""
import os
import asyncio
import threading
import urllib.parse
from dotenv import load_dotenv
import requests

from flask import Flask, request, render_template
from telegram import KeyboardButton, ReplyKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# Load environment variables from .env file
load_dotenv()

# Get configuration from environment
TOKEN = os.environ.get("TELEGRAM_TOKEN")
WEB_APP_URL = os.environ.get("WEB_APP_URL", "http://localhost:5000/")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
RIG_SERVICE_URL = os.environ.get("RIG_SERVICE_URL", "http://localhost:8000/rig")
RIG_API_KEY = os.environ.get("RIG_API_KEY", "")

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


@app.after_request
def ensure_js_mime(response):
    """Ensure JavaScript files have correct MIME type for ES modules."""
    if request.path.endswith('.js'):
        response.mimetype = 'text/javascript'
    return response


@app.after_request
def add_hsts_header(response):
    """Force HTTPS on supported browsers."""
    response.headers.setdefault('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
    return response


@app.route("/")
def index():
    """Serve the WebApp's main page."""
    return render_template("index.html")


@app.route("/rig", methods=["POST"])
def rig_endpoint():
    """Proxy rig requests to the dedicated service."""
    try:
        if 'file' in request.files:
            f = request.files['file']
            files = {'file': (f.filename, f.stream.read(), f.mimetype)}
            resp = requests.post(RIG_SERVICE_URL, files=files, headers={'X-Api-Key': RIG_API_KEY})
        else:
            resp = requests.post(RIG_SERVICE_URL, data=request.get_data(), headers={'Content-Type': request.content_type, 'X-Api-Key': RIG_API_KEY})
        return (resp.content, resp.status_code, {'Content-Type':'application/json'})
    except Exception as e:
        print(f"Rig proxy error: {e}")
        return {"error": "rig unavailable"}, 502


@app.route("/telemetry", methods=["POST"])
def telemetry_endpoint():
    """Receive simple FPS telemetry from clients."""
    try:
        data = request.get_json(force=True)
        print("Telemetry:", data)
        return {"status": "ok"}
    except Exception as e:
        print(f"Telemetry error: {e}")
        return {"error": "bad request"}, 400




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
    """Send the user a button that opens the WebApp."""

    keyboard = [
        [KeyboardButton("🚀 Open Spromoji", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

    welcome_text = (
        "🎭 Welcome to Spromoji!\n\n"
        "Mirror your expressions with your avatar in real-time.\n\n"
        "📸 Upload an image to begin."
    )

    await update.message.reply_text(welcome_text, reply_markup=reply_markup)


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

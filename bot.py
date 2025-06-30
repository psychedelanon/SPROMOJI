"""Telegram bot and Flask app for the Spromoji WebApp."""
import os
import asyncio
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


@app.route("/")
def index():
    """Serve the WebApp's main page."""
    return render_template("index.html")


@app.route("/webhook", methods=["POST"])
def webhook():
    """Process incoming Telegram updates sent via webhook."""
    update = Update.de_json(request.get_json(force=True), application.bot)
    asyncio.create_task(application.process_update(update))
    return "OK"


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a button that opens the WebApp."""
    keyboard = [
        [KeyboardButton("Open Spromoji", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
    await update.message.reply_text(
        "Welcome! Tap the button below to launch Spromoji.",
        reply_markup=reply_markup,
    )


application.add_handler(CommandHandler("start", start))


async def setup_webhook():
    """Set up the webhook for production."""
    if WEBHOOK_URL:
        await application.bot.set_webhook(f"{WEBHOOK_URL}/webhook")
        print(f"Webhook set to: {WEBHOOK_URL}/webhook")
    else:
        print("No WEBHOOK_URL set, skipping webhook setup")


if __name__ == "__main__":
    # Initialize the application
    asyncio.get_event_loop().run_until_complete(application.initialize())
    
    # Set up webhook if URL is provided
    if WEBHOOK_URL:
        asyncio.get_event_loop().run_until_complete(setup_webhook())
    else:
        print("Running without webhook (for local development)")

    # Start the Flask web server
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

"""Telegram bot and Flask app for the Spromoji WebApp."""
import os
import threading

from flask import Flask, request, render_template
from telegram import (KeyboardButton, ReplyKeyboardMarkup, Update,
                      WebAppInfo)
from telegram.ext import CommandHandler, Dispatcher, Updater

# Get configuration from environment
TOKEN = os.environ.get("TELEGRAM_TOKEN")
WEB_APP_URL = os.environ.get("WEB_APP_URL", "http://localhost:5000/")

# Initialize the Telegram updater/dispatcher
updater = Updater(token=TOKEN, use_context=True)
dispatcher: Dispatcher = updater.dispatcher

app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    """Serve the WebApp's main page."""
    return render_template("index.html")


@app.route("/webhook", methods=["POST"])
def webhook() -> str:
    """Process incoming Telegram updates sent via webhook."""
    update = Update.de_json(request.get_json(force=True), updater.bot)
    dispatcher.process_update(update)
    return "OK"


def start(update: Update, context) -> None:
    """Send a button that opens the WebApp."""
    keyboard = [
        [KeyboardButton("Open Spromoji", web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
    update.message.reply_text(
        "Welcome! Tap the button below to launch Spromoji.",
        reply_markup=reply_markup,
    )


dispatcher.add_handler(CommandHandler("start", start))


def run_polling():
    """Start the bot in polling mode (used when WEBHOOK_URL is not set)."""
    updater.start_polling()
    updater.idle()


if __name__ == "__main__":
    webhook_url = os.environ.get("WEBHOOK_URL")

    if webhook_url:
        # Configure Telegram to send updates to our webhook
        updater.bot.set_webhook(f"{webhook_url}/webhook")
    else:
        # Start polling in a separate thread for local development
        thread = threading.Thread(target=run_polling)
        thread.start()

    # Start the Flask web server to serve the WebApp
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))

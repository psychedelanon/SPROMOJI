# Spromoji

Spromoji is a Telegram bot with a small WebApp that lets you mirror your
facial expressions on a 2D avatar. You can record the animation and share it
with friends directly from Telegram.

## Development setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Set the required environment variables:
   - `TELEGRAM_TOKEN` – your bot token from [BotFather](https://t.me/BotFather).
   - `WEBHOOK_URL` – public URL for Telegram to send webhooks (skip to use polling).
   - `WEB_APP_URL` – URL where the WebApp is served (default `http://localhost:5000/`).

3. Run the bot:

```bash
python bot.py
```

When running with polling, the bot will start in the background and the
Flask server will serve the WebApp on port `5000` by default.

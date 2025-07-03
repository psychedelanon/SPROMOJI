# Spromoji

Spromoji is a Telegram mini-application inspired by Apple's Memoji. It will allow users to animate their profile picture (PFP) – specifically Sproto Gremlins NFT avatars – so that the avatar mirrors the user's facial expressions in real time.

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

## Recent changes

- MediaPipe face tracking results are now smoothed across frames for a more fluid Memoji-like animation.
- Landmark smoothing uses the `LANDMARK_SMOOTHING` constant in `script.js` so the effect can be tuned.
- Facial features now morph to the detected eye and mouth shape for a closer match to your real expressions.
- Pupils and mouth position now follow your movements for natural blinking and talking.
- Eye and mouth regions are clipped to smooth ellipses so scaling no longer shows square artifacts.
- Video recording now includes microphone audio and automatically downloads when finished.
- Facial features now react to head yaw and pitch for a subtle 3D effect.
- Facial rig uses triangulated mesh driven by Face Landmarker blendshapes for accurate motion.
- Avatar anchor points are stored in `avatarRig.json` and only need to be clicked once.
- Recording chooses MP4/H.264 when available so downloads play everywhere.
- Cartoon avatars are detected more reliably using combined dark/bright eye candidates.

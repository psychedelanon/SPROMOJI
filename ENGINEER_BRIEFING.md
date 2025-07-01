# Spromoji Engineer Briefing

## Detection Flow
1. On load, the app attempts quick cartoon detection via `AutoRegions.detectCartoon()` using HSV masks and edge clustering. If successful the regions are used directly.
2. If that fails, MediaPipe FaceMesh runs (`initializeMediaPipe` creates the detector once). Landmarks are converted with `AutoRegions.fromLandmarks`.
3. When both methods fail a manual region picker is offered.

## Debug Tips
- Append `?debug=1` to the WebApp URL to show landmark overlay.
- Status messages in the page reflect each step of initialization.
- Use browser console for detailed logs prefixed with `[spromoji]`.

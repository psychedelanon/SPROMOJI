// Basic face tracking and avatar animation logic
// This script uses MediaPipe FaceMesh to detect landmarks and draws a simple
// avatar representation on a canvas. Recording is handled via the MediaRecorder
// API on the canvas stream.

document.addEventListener('DOMContentLoaded', () => {
  const tg = window.Telegram.WebApp;
  if (tg && tg.expand) tg.expand();

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const avatarImg = document.getElementById('avatar');
  const avatarInput = document.getElementById('avatarInput');
  const startBtn = document.getElementById('startBtn');

  // Load selected avatar image
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    avatarImg.src = url;
    avatarImg.onload = () => URL.revokeObjectURL(url);
    avatarImg.style.display = 'none';
  });

  // Request access to webcam
  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    video.srcObject = stream;
    video.play();

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);

    const camera = new Camera(video, {
      onFrame: async () => {
        await faceMesh.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  });

  function onResults(results) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (avatarImg.complete) {
      ctx.drawImage(avatarImg, 0, 0, canvas.width, canvas.height);
    }

    if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
      const landmarks = results.multiFaceLandmarks[0];
      // Simple example: draw circles over eyes and mouth position
      const leftEye = landmarks[468];
      const rightEye = landmarks[473];
      const mouth = landmarks[13];
      const scaleX = canvas.width;
      const scaleY = canvas.height;
      ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(leftEye.x * scaleX, leftEye.y * scaleY, 10, 0, 2 * Math.PI);
      ctx.arc(rightEye.x * scaleX, rightEye.y * scaleY, 10, 0, 2 * Math.PI);
      ctx.arc(mouth.x * scaleX, mouth.y * scaleY, 15, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Handle recording of the canvas animation
  let recorder;
  let chunks = [];

  startBtn.addEventListener('click', () => {
    if (!recorder) {
      const stream = canvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'avatar.webm';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        chunks = [];
      };
      recorder.start();
      startBtn.textContent = 'Stop Recording';
    } else if (recorder.state === 'recording') {
      recorder.stop();
      recorder = null;
      startBtn.textContent = 'Start Recording';
    }
  });
});

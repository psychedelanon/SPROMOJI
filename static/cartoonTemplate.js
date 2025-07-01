/* Avatar Template Library - Multiple Themes for GTM Launch */

window.CartoonTemplate = function(imgW, imgH, theme = 'default') {
  const templates = {
    // Default Pepe-style template  
    default: {
      leftEye:  box(0.24, 0.32, 0.18, 0.13),
      rightEye: box(0.58, 0.32, 0.18, 0.13),
      mouth:    box(0.34, 0.63, 0.32, 0.18),
      theme: 'Default Avatar'
    },
    
    // HarryPotterObamaSonic10Inu theme - UI styling only, same regions as default
    harrypotterobamasonic10inu: {
      leftEye:  box(0.24, 0.32, 0.18, 0.13),  // Same as default
      rightEye: box(0.58, 0.32, 0.18, 0.13),  // Same as default  
      mouth:    box(0.34, 0.63, 0.32, 0.18),  // Same as default
      theme: '🧙‍♂️🇺🇸🦔10🐕 HarryPotterObamaSonic10Inu (UI Theme Only)'
    },
    
    // Classic anime style for broader appeal
    anime: {
      leftEye:  box(0.26, 0.30, 0.20, 0.15),  // Large anime eyes
      rightEye: box(0.54, 0.30, 0.20, 0.15),
      mouth:    box(0.36, 0.60, 0.28, 0.12),
      theme: 'Anime Style'
    },
    
    // Realistic human proportions
    realistic: {
      leftEye:  box(0.30, 0.35, 0.15, 0.08),
      rightEye: box(0.55, 0.35, 0.15, 0.08),
      mouth:    box(0.38, 0.65, 0.24, 0.10),
      theme: 'Realistic'
    }
  };
  
  function box(rx, ry, rw, rh) {
    return { 
      x: Math.round(rx * imgW), 
      y: Math.round(ry * imgH), 
      w: Math.round(rw * imgW), 
      h: Math.round(rh * imgH) 
    };
  }
  
  const template = templates[theme] || templates.default;
  console.log(`[CartoonTemplate] Using theme: ${template.theme}`);
  
  return template;
};

// Theme selector helper
window.CartoonTemplate.getAvailableThemes = function() {
  return [
    { key: 'default', name: 'Default Avatar', emoji: '😀' },
    { key: 'harrypotterobamasonic10inu', name: 'HarryPotterObamaSonic10Inu', emoji: '🧙‍♂️🇺🇸🦔10🐕', viral: true },
    { key: 'anime', name: 'Anime Style', emoji: '👁️' },
    { key: 'realistic', name: 'Realistic', emoji: '👤' }
  ];
}; 
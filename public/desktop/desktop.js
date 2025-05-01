// Desktop Interface Logic - public/desktop/desktop.js
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const tuningKnob = document.getElementById('tuning-knob');
  const currentFrequencyDisplay = document.getElementById('current-frequency');
  const volumeControl = document.getElementById('volume');
  const statusElement = document.getElementById('status');
  const pairingCodeElement = document.getElementById('pairing-code');
  const messagesElement = document.getElementById('messages');
  const staticAudio = document.getElementById('static-audio');
  const signalBars = [
    document.getElementById('signal-bar-1'),
    document.getElementById('signal-bar-2'),
    document.getElementById('signal-bar-3'),
    document.getElementById('signal-bar-4'),
    document.getElementById('signal-bar-5')
  ];
  
  // State
  let rotation = 0; // Current rotation of the tuning knob in degrees
  let currentFrequency = 87.5; // Starting frequency
  let isDragging = false;
  let lastMouseX = 0;
  let isFrequencyActive = false;
  let socket = null;
  let desktopVisualizer = null; // Add missing variable
  
  // Active frequencies that have content
  const activeFrequencies = ['87.5', '89.3', '92.1', '95.7', '98.7', '101.2', '104.3', '107.9', '110.5'];
  
  // Connect to WebSocket server
  function connectSocket() {
    socket = io();
    
    // Add connection monitoring
    socket.on('connect', () => {
      console.log("Socket connected:", socket.id);
      statusElement.textContent = 'Connected';
      statusElement.style.color = '#4caf50';
      
      // Register as desktop client
      socket.emit('register', { type: 'desktop' });
    });
    
    socket.on('connect_error', (error) => {
      console.error("Socket connection error:", error);
      statusElement.textContent = 'Connection failed';
      statusElement.style.color = '#f44336';
      addMessage('SYSTEM', 'Connection error. Please check your network.', 'system');
    });
    
    socket.on('disconnect', (reason) => {
      console.log("Socket disconnected:", reason);
      statusElement.textContent = 'Disconnected';
      statusElement.style.color = '#f44336';
      addMessage('SYSTEM', `Disconnected: ${reason}. Try reloading.`, 'system');
    });
    
    // Enhanced AI response handling
    socket.on('ai_response', (data) => {
      console.log("Received AI response:", data);
      if (data && data.message) {
        addMessage(data.character, data.message, 'character');
        
        // Play audio if available
        if (data.audioPath) {
          console.log('Playing audio from path:', data.audioPath);
          playGeneratedAudio(data.audioPath);
        } else {
          addMessage('SYSTEM', 'No audio available for this transmission', 'system');
        }
      } else {
        console.error("Invalid AI response data:", data);
        addMessage('SYSTEM', 'Received invalid response from server', 'system');
      }
    });
    
    socket.on('registered', (data) => {
      pairingCodeElement.textContent = `Pairing Code: ${data.pairing_code}`;
    });
    
    socket.on('paired', (data) => {
      if (data.success) {
        statusElement.textContent = 'Paired with mobile';
        statusElement.style.color = '#2196f3';
      }
    });
    
    socket.on('frequency_active', (data) => {
      console.log("Frequency active event received:", data);
      isFrequencyActive = data.active;
      updateFrequencyDisplay();
      
      if (data.active) {
        console.log("Setting active signal strength");
        updateSignalBars();
        
        // Ensure display elements exist
        const frequencyDisplay = document.querySelector('.frequency-display') || createDisplayElement('frequency-display');
        const characterDisplay = document.querySelector('.character-display') || createDisplayElement('character-display');
        const locationDisplay = document.querySelector('.location-display') || createDisplayElement('location-display');
        
        // Update UI to show active frequency
        frequencyDisplay.textContent = `Active: ${currentFrequency} MHz`;
        characterDisplay.textContent = `Character: ${data.character}`;
        locationDisplay.textContent = `Location: ${data.location}`;
        
        // Update narrative progress if provided
        if (data.narrativeContext) {
          updateNarrativeProgress(data.storyProgress || 0, data.narrativeContext);
        }
        
        // Add system message about the frequency
        addMessage('SYSTEM', `Tuned to frequency ${currentFrequency} MHz. ${data.character} detected at ${data.location}.`, 'system');
      } else {
        console.log("Setting inactive signal strength");
        const randomStrength = Math.floor(Math.random() * 3);
        updateSignalBars();
        
        // Ensure display elements exist
        const frequencyDisplay = document.querySelector('.frequency-display') || createDisplayElement('frequency-display');
        const characterDisplay = document.querySelector('.character-display') || createDisplayElement('character-display');
        const locationDisplay = document.querySelector('.location-display') || createDisplayElement('location-display');
        
        // Update UI to show static
        frequencyDisplay.textContent = `Static: ${currentFrequency} MHz`;
        characterDisplay.textContent = 'Character: None';
        locationDisplay.textContent = 'Location: Unknown';
        
        // Add system message about static
        addMessage('SYSTEM', `Only static on frequency ${currentFrequency} MHz.`, 'system');
      }
    });
    
    socket.on('mobile_disconnected', () => {
      statusElement.textContent = 'Connected (Mobile disconnected)';
      statusElement.style.color = '#ff9800';
      addMessage('SYSTEM', 'Mobile device disconnected', 'system');
    });
  }
  
  // Initialize audio context for static sound
  let audioContext = null;
  let staticGainNode = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let speechRecognition = null;
  let buttonSoundGainNode = null;
  let audioAnalyser = null;
  let visualizerCanvas = null;
  let visualizerContext = null;
  let visualizerData = null;
  
  // Function to initialize noise generation
  function initAudio() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create gain node for volume control
      staticGainNode = audioContext.createGain();
      staticGainNode.gain.value = 0.7;
      
      // Create a noise generator for continuous static
      createNoiseGenerator();
      
      // Initialize visualizer after short delay
      setTimeout(() => {
        try {
          // Initialize visualizer
          desktopVisualizer = setupDesktopVisualizer();
        } catch (vizError) {
          console.error('Visualizer initialization failed:', vizError);
        }
      }, 500);
    } catch (error) {
      console.error('Audio context initialization failed:', error);
    }
  }

  // Function to create a noise generator for static
  function createNoiseGenerator() {
    try {
      // Use modern AudioWorklet if available
      if (window.AudioWorkletNode && audioContext.audioWorklet) {
        // This is a more modern approach but requires more setup
        // For simplicity, we'll use the older method with a note about the deprecation
        console.log("AudioWorkletNode is supported but using ScriptProcessor for compatibility");
      }
      
      // Create a ScriptProcessorNode
      const bufferSize = 4096;
      const noiseNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      // Generate white noise
      noiseNode.onaudioprocess = function(e) {
        const output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          // Generate white noise
          output[i] = Math.random() * 2 - 1;
        }
      };
      
      // Create filter to shape noise into more "radio static" sound
      window.staticFilterNode = audioContext.createBiquadFilter();
      window.staticFilterNode.type = 'bandpass';
      window.staticFilterNode.frequency.value = 1000;
      window.staticFilterNode.Q.value = 0.5;
      
      // Connect nodes
      noiseNode.connect(window.staticFilterNode);
      window.staticFilterNode.connect(staticGainNode);
      staticGainNode.connect(audioContext.destination);
      
      // Keep reference to nodes to prevent garbage collection
      window.noiseNode = noiseNode;
      
      console.log("Continuous static generator initialized");
      return true;
    } catch (error) {
      console.error("Error creating noise generator:", error);
      return false;
    }
  }
  
  // Update the frequency display
  function updateFrequencyDisplay() {
    // Format to one decimal place for display
    const formattedFrequency = parseFloat(currentFrequency.toFixed(1));
    currentFrequencyDisplay.textContent = formattedFrequency.toFixed(1);
    
    // Visual feedback for active frequency
    if (isFrequencyActive) {
      currentFrequencyDisplay.classList.add('frequency-active');
    } else {
      currentFrequencyDisplay.classList.remove('frequency-active');
    }
    
    // Update signal bars based on proximity to active frequencies
    updateSignalBars();
    
    // Adjust static volume
    adjustStaticVolume();
  }
  
  // New function specifically for updating signal bars
  function updateSignalBars() {
    let signalStrength = 0;
    
    if (isFrequencyActive) {
      // Full signal when on active frequency
      signalStrength = 5;
    } else {
      // Calculate proximity to nearest active frequency
      let minDistance = 100;
      for (const freq of activeFrequencies) {
        const distance = Math.abs(currentFrequency - parseFloat(freq));
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
      
      // Map distance to signal strength (0-4)
      if (minDistance < 0.1) signalStrength = 4;
      else if (minDistance < 0.3) signalStrength = 3;
      else if (minDistance < 0.7) signalStrength = 2;
      else if (minDistance < 1.5) signalStrength = 1;
      else signalStrength = 0;
    }
    
    console.log(`Frequency: ${currentFrequency.toFixed(1)}, Signal strength: ${signalStrength}`);
    
    // Update the visual signal bars
    signalBars.forEach((bar, index) => {
      if (index < signalStrength) {
        bar.classList.add('active');
      } else {
        bar.classList.remove('active');
      }
    });
  }
  
  // Adjust static volume based on proximity to active frequency
  function adjustStaticVolume() {
    if (!staticGainNode) return;
    
    // Find distance to nearest active frequency
    let minDistance = 20; // Initialize with a large value
    
    for (const freq of activeFrequencies) {
      const distance = Math.abs(currentFrequency - freq);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    
    // Static gets quieter as we get closer to an active frequency
    let staticVolume;
    if (isFrequencyActive) {
      staticVolume = 0.1; // Very quiet when on active frequency
    } else {
      // Scale from 0.3 to 1.0 based on distance
      staticVolume = 0.3 + (0.7 * Math.min(minDistance * 5, 1.0));
    }
    
    // Apply volume with a smooth transition
    staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
    staticGainNode.gain.linearRampToValueAtTime(
      staticVolume, 
      audioContext.currentTime + 0.2
    );
    
    // Update filter parameters if we have a filter node (safely check first)
    if (window.staticFilterNode) {
      staticFilterNode.frequency.setValueAtTime(staticFilterNode.frequency.value, audioContext.currentTime);
      staticFilterNode.frequency.linearRampToValueAtTime(
        isFrequencyActive ? 800 : 800 + (1200 * Math.min(minDistance * 3, 1.0)),
        audioContext.currentTime + 0.2
      );
      
      staticFilterNode.Q.setValueAtTime(staticFilterNode.Q.value, audioContext.currentTime);
      staticFilterNode.Q.linearRampToValueAtTime(
        isFrequencyActive ? 0.2 : 0.2 + (1.8 * Math.min(minDistance * 3, 1.0)),
        audioContext.currentTime + 0.2
      );
    }
  }
  
  // Add message to the conversation log
  function addMessage(character, message, type = 'system') {
    const messagesElement = document.getElementById('messages');
    if (!messagesElement) {
      console.error('Messages element not found');
      return;
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;

    // Format the message content
    let formattedMessage = message;
    if (typeof message === 'object') {
      if (message.text) {
        formattedMessage = message.text;
      } else if (message.message) {
        formattedMessage = message.message;
      } else {
        formattedMessage = JSON.stringify(message, null, 2);
      }
    }

    // Create character label if provided
    if (character) {
      const characterLabel = document.createElement('span');
      characterLabel.className = 'character-label';
      characterLabel.textContent = `${character}: `;
      messageElement.appendChild(characterLabel);
    }

    // Add the message text
    const messageText = document.createElement('span');
    messageText.className = 'message-text';
    messageText.textContent = formattedMessage;
    messageElement.appendChild(messageText);

    messagesElement.appendChild(messageElement);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }
  
  // Play transmission audio (with voice effect)
  function playTransmissionAudio(text) {
    // In a full implementation, this would use Text-to-Speech with effects
    // For this prototype, we'll simulate it
    console.log('Would play audio for:', text);
    
    // Create a temporary audio element for the transmission
    const transmissionAudio = document.getElementById('transmission-audio');
    if (transmissionAudio && audioContext) {
      // Apply radio voice effect
      createRadioVoiceEffect(transmissionAudio);
      
      // In a full implementation, this would be actual audio
      // For now, we'll just play the static sound
      transmissionAudio.play();
    }
    
    // Adding placeholder notification
    addMessage('SYSTEM', 'Playing transmission audio (simulated for prototype)', 'system');
  }
  
  // Create radio voice effect
  function createRadioVoiceEffect(audioElement) {
    const source = audioContext.createMediaElementSource(audioElement);
    
    // Create filter nodes for radio effect
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2000;
    
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 500;
    
    // Create distortion for radio "crunch"
    const distortion = audioContext.createWaveShaper();
    distortion.curve = createDistortionCurve(100);
    distortion.oversample = '4x';
    
    // Connect the nodes
    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(distortion);
    distortion.connect(audioContext.destination);
    
    return source;
  }
  
  // Helper function to create distortion curve
  function createDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
    }
    
    return curve;
  }
  
  // Debounce frequency changes to avoid spamming the server
  let frequencyChangeTimeout = null;
  function debounceFrequencyChange() {
    if (frequencyChangeTimeout) {
      clearTimeout(frequencyChangeTimeout);
    }
    
    frequencyChangeTimeout = setTimeout(() => {
      if (socket) {
        socket.emit('tune', { frequency: currentFrequency.toFixed(1) });
      }
    }, 200);
  }
  
  // Initialize tuning knob interaction
  function initTuningKnob() {
    tuningKnob.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastMouseX = e.clientX;
      tuningKnob.style.cursor = 'grabbing';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - lastMouseX;
      lastMouseX = e.clientX;
      
      // Update rotation
      rotation += deltaX;
      tuningKnob.style.transform = `rotate(${rotation}deg)`;
      
      // Map rotation to frequency range (87.5 - 108.0 MHz)
      // 600 degrees of rotation maps to full FM band
      const normalizedRotation = (rotation % 600 + 600) % 600;
      // Calculate raw frequency
      const rawFrequency = 87.5 + (normalizedRotation / 600) * 20.5;
      // Round to nearest 0.1 for more realistic FM tuning
      currentFrequency = Math.round(rawFrequency * 10) / 10;
      
      // Clamp to valid FM range
      currentFrequency = Math.max(87.5, Math.min(108.0, currentFrequency));
      
      // Update display and signal strength
      updateFrequencyDisplay();
      adjustStaticVolume(); // Update signal strength based on proximity to active frequencies
      
      // Notify server about frequency change (debounced)
      debounceFrequencyChange();
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        tuningKnob.style.cursor = 'grab';
        
        // Final frequency update
        if (socket) {
          socket.emit('tune', { frequency: currentFrequency.toFixed(1) });
        }
      }
    });
    
    // Volume control
    volumeControl.addEventListener('input', (e) => {
      const volume = e.target.value / 100;
      
      if (staticGainNode) {
        staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
        staticGainNode.gain.linearRampToValueAtTime(
          volume, 
          audioContext.currentTime + 0.1
        );
      }
    });
  }
  
  // Create a fake visualizer that responds to incoming messages
  function setupDesktopVisualizer() {
    try {
      // First check if the element exists
      const conversationLog = document.querySelector('.conversation-log');
      if (!conversationLog) {
        console.error('Could not find conversation log element');
        return { showActivity: () => {} }; // Return dummy function
      }
      
      // Create canvas for visualizer
      const visualizerCanvas = document.createElement('canvas');
      visualizerCanvas.className = 'audio-visualizer';
      visualizerCanvas.width = 300;
      visualizerCanvas.height = 60;
      
      // Insert at correct position
      const messagesElement = document.querySelector('.messages');
      if (messagesElement) {
        conversationLog.insertBefore(visualizerCanvas, messagesElement);
      } else {
        conversationLog.appendChild(visualizerCanvas); // Fallback
      }
      
      // Get context
      const visualizerContext = visualizerCanvas.getContext('2d');
      
      // Draw initial flat line
      drawFlatLine();
      
      // Function to draw a flat line
      function drawFlatLine() {
        visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        visualizerContext.fillStyle = '#222';
        visualizerContext.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        visualizerContext.beginPath();
        visualizerContext.strokeStyle = '#444';
        visualizerContext.moveTo(0, visualizerCanvas.height / 2);
        visualizerContext.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
        visualizerContext.stroke();
      }
      
      // Function to simulate activity
      function simulateActivity(duration = 2000) {
        let startTime = Date.now();
        
        function draw() {
          const elapsed = Date.now() - startTime;
          if (elapsed > duration) {
            drawFlatLine();
            return;
          }
          
          // Clear canvas
          visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
          visualizerContext.fillStyle = '#222';
          visualizerContext.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
          
          // Draw bars
          const barCount = 20;
          const barWidth = visualizerCanvas.width / barCount;
          
          for (let i = 0; i < barCount; i++) {
            // Random height with decay over time
            const decay = 1 - (elapsed / duration);
            const randomFactor = Math.random() * 0.5 + 0.5; // 0.5 to 1.0
            const height = (visualizerCanvas.height * 0.8) * randomFactor * decay;
            
            visualizerContext.fillStyle = isFrequencyActive ? '#4caf50' : '#666';
            visualizerContext.fillRect(
              i * barWidth,
              (visualizerCanvas.height - height) / 2,
              barWidth - 1,
              height
            );
          }
          
          requestAnimationFrame(draw);
        }
        
        draw();
      }
      
      return {
        showActivity: simulateActivity
      };
    } catch (error) {
      console.error('Error setting up desktop visualizer:', error);
      return { showActivity: () => {} }; // Return dummy function
    }
  }

  // Initialize the application
  function init() {
    // Add transmission indicator
    const transmissionIndicator = document.createElement('div');
    transmissionIndicator.className = 'transmission-indicator';
    
    // Find a suitable container element that exists
    const container = document.querySelector('.frequency-display') || 
                     document.querySelector('.conversation-log') || 
                     document.body;
    
    if (container) {
      container.appendChild(transmissionIndicator);
    } else {
      console.warn('Could not find suitable container for transmission indicator');
    }

    // Check for browser compatibility
    const compatibilityCheck = {
      audioContext: !!(window.AudioContext || window.webkitAudioContext),
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    };

    console.log('Browser compatibility:', compatibilityCheck);

    // Add warnings for missing features
    if (!compatibilityCheck.audioContext || !compatibilityCheck.mediaDevices) {
      addSystemMessage('Warning: Your browser may not support all audio features. For the best experience, please use Chrome.');
    }
    if (!compatibilityCheck.speechRecognition) {
      addSystemMessage('Warning: Speech recognition is not supported in your browser. You can still use text input.');
    }

    // Add initial system message
    addMessage('SYSTEM', 'Radio initialized. Connecting to server...', 'system');
    
    // Initialize WebSocket connection
    connectSocket();
    
    // Initialize tuning knob
    initTuningKnob();
    
    // Initialize desktop visualizer
    const desktopVisualizer = setupDesktopVisualizer();
    
    // Initialize audio on first user interaction
    document.addEventListener('click', () => {
      if (!audioContext) {
        initAudio();
        addMessage('SYSTEM', 'Audio initialized', 'system');
      }
    }, { once: true });
  }
  
  // Add debug button to the interface
  const debugButton = document.createElement('button');
  debugButton.textContent = 'Debug Signal';
  debugButton.style.position = 'fixed';
  debugButton.style.bottom = '10px';
  debugButton.style.right = '10px';
  debugButton.style.zIndex = '1000';
  document.body.appendChild(debugButton);

  debugButton.addEventListener('click', () => {
    console.log('Current frequency:', currentFrequency);
    console.log('Is frequency active:', isFrequencyActive);
    console.log('Active frequencies:', activeFrequencies);
    
    // Test each signal level
    for (let i = 0; i <= 5; i++) {
      setTimeout(() => {
        console.log(`Setting signal level to ${i}`);
        updateSignalBars(i);
      }, i * 500);
    }
  });
  
  // Start the application
  init();

  // Add narrative progress tracking
  function updateNarrativeProgress(progress, narrativeContext) {
    // Create or update progress element if it doesn't exist
    let progressElement = document.getElementById('narrative-progress');
    
    if (!progressElement) {
      progressElement = document.createElement('div');
      progressElement.id = 'narrative-progress';
      progressElement.className = 'narrative-progress';
      document.querySelector('.conversation-log').prepend(progressElement);
    }
    
    // Update content
    progressElement.innerHTML = `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="narrative-status">Story Progress: ${progress}%</div>
    `;
    
    // Add system message about narrative development
    if (narrativeContext === 'plot_twist') {
      addMessage('SYSTEM', 'Strange inconsistencies detected in communications. Narrative taking unexpected turn.', 'system');
    } else if (narrativeContext === 'advanced' && progress > 75) {
      addMessage('SYSTEM', 'Communications converging. Story approaching conclusion.', 'system');
    }
  }

  // Function to play generated audio with radio effects
  function playGeneratedAudio(audioPath) {
    // Create audio element
    const audioElement = new Audio(audioPath);
    
    // Prepare audio nodes
    const source = audioContext.createMediaElementSource(audioElement);
    
    // Create radio effect filter chain
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 0.7;
    
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 500;
    
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2500;
    
    // Create distortion for radio "crunch"
    const distortion = audioContext.createWaveShaper();
    distortion.curve = createDistortionCurve(20);
    distortion.oversample = "4x";
    
    // Lower static volume during speech
    if (staticGainNode) {
      staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
      staticGainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.2);
    }
    
    // Connect nodes
    source.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(distortion);
    distortion.connect(audioContext.destination);
    
    // Play audio
    audioElement.play();
    
    // Restore static volume when finished
    audioElement.onended = function() {
      if (staticGainNode) {
        adjustStaticVolume();
      }
    };
  }

  // Update startTransmitting and stopTransmitting to toggle indicator
  async function startTransmitting(e) {
    e.preventDefault();
    
    if (!isPaired || !isFrequencyActive || isTransmitting) {
      console.log("Cannot transmit: ", {isPaired, isFrequencyActive, isTransmitting});
      return;
    }
    
    isTransmitting = true;
    pushToTalkButton.classList.add('active');
    document.querySelector('.transmission-indicator').classList.add('active');
    
    // Play button sound instead of static
    playButtonSound('start');
    
    console.log("Starting transmission...");
    
    // Clear previous speech text
    const speechText = document.querySelector('.speech-text');
    if (speechText) speechText.textContent = '';
    
    // Request microphone access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Start visualizer
      startAudioVisualization(stream);
      
      // Start speech recognition
      if (speechRecognition) {
        try {
          speechRecognition.start();
        } catch (error) {
          console.error('Speech recognition start error:', error);
        }
      } else {
        // Fallback to text input
        const userMessage = prompt('Enter your message:');
        
        if (userMessage && userMessage.trim() !== '') {
          console.log("Sending message:", userMessage);
          addMessage('YOU', userMessage, 'user');
          
          if (socket) {
            socket.emit('audio_message', { message: userMessage });
          }
        }
      }
    } catch (error) {
      console.error('Microphone access error:', error);
      addMessage('SYSTEM', `Microphone error: ${error.message}`, 'system');
      isTransmitting = false;
      pushToTalkButton.classList.remove('active');
      document.querySelector('.transmission-indicator').classList.remove('active');
    }
  }

  function stopTransmitting(e) {
    e.preventDefault();
    
    if (!isTransmitting) return;
    
    isTransmitting = false;
    pushToTalkButton.classList.remove('active');
    document.querySelector('.transmission-indicator').classList.remove('active');
    
    // Play button sound
    playButtonSound('end');
    
    // Stop speech recognition
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (error) {
        console.error('Speech recognition stop error:', error);
      }
    }
    
    // Update visualizer (it will draw flat line on next frame)
  }

  // Helper function to create display elements
  function createDisplayElement(className) {
    const element = document.createElement('div');
    element.className = className;
    
    // Find a suitable container
    const container = document.querySelector('.radio-interface') || 
                     document.querySelector('.conversation-log') || 
                     document.body;
    
    container.appendChild(element);
    return element;
  }

  // Add audio visualizer setup
  function setupAudioVisualizer() {
    // Create canvas for visualizer
    visualizerCanvas = document.createElement('canvas');
    visualizerCanvas.className = 'audio-visualizer';
    visualizerCanvas.width = 300;
    visualizerCanvas.height = 60;
    
    // Add to the interface
    const container = document.createElement('div');
    container.className = 'visualizer-container';
    container.appendChild(visualizerCanvas);
    
    document.querySelector('.radio-interface').insertBefore(
      container, 
      document.querySelector('.controls')
    );
    
    // Get context
    visualizerContext = visualizerCanvas.getContext('2d');
    
    // Initialize visualizer when audio context is ready
    if (audioContext) {
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 64; // Larger size for desktop visualization
      visualizerData = new Uint8Array(audioAnalyser.frequencyBinCount);
    }
  }

  // Function to start visualizing audio
  function startAudioVisualization(stream) {
    if (!audioContext || !audioAnalyser) return;
    
    // Connect the stream to the analyzer
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);
    
    // Start drawing
    drawVisualizer();
  }

  // Function to draw the visualizer
  function drawVisualizer() {
    if (!isTransmitting || !audioAnalyser || !visualizerContext) {
      // If not transmitting, draw flat line
      visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
      visualizerContext.fillStyle = '#333';
      visualizerContext.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
      visualizerContext.beginPath();
      visualizerContext.strokeStyle = '#666';
      visualizerContext.moveTo(0, visualizerCanvas.height / 2);
      visualizerContext.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
      visualizerContext.stroke();
      return;
    }
    
    // Get frequency data
    audioAnalyser.getByteFrequencyData(visualizerData);
    
    // Clear canvas
    visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    visualizerContext.fillStyle = '#333';
    visualizerContext.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    
    // Draw bars
    const barWidth = visualizerCanvas.width / visualizerData.length;
    visualizerContext.fillStyle = '#4caf50';
    
    for (let i = 0; i < visualizerData.length; i++) {
      const value = visualizerData[i] / 255;
      const barHeight = value * visualizerCanvas.height;
      
      visualizerContext.fillRect(
        i * barWidth,
        visualizerCanvas.height - barHeight,
        barWidth - 1,
        barHeight
      );
    }
    
    // Continue animation
    requestAnimationFrame(drawVisualizer);
  }
});

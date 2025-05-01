// Mobile Interface Logic - public/mobile/mobile.js
console.log('Mobile interface initializing...');

document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const statusElement = document.getElementById('status');
  const pairingCodeInput = document.getElementById('pairing-code');
  const pairButton = document.getElementById('pair-button');
  const pushToTalkButton = document.getElementById('push-to-talk');
  const activeFrequencyElement = document.getElementById('active-frequency');
  const messagesElement = document.getElementById('messages');
  const staticAudio = document.getElementById('static-audio');
  
  // State
  let socket = null;
  let isPaired = false;
  let isFrequencyActive = false;
  let currentCharacter = null;
  let isTransmitting = false;
  let audioContext = null;
  let staticGainNode = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let speechRecognition = null;
  let buttonSoundGainNode = null;
  let recognitionTimeout = null;
  let audioAnalyser = null;
  let visualizerCanvas = null;
  let visualizerContext = null;
  let visualizerData = null;
  
  // Connect to WebSocket server
  function connectSocket() {
    socket = io();
    
    // Log WebSocket connection attempts
    socket.on('connect', () => {
      console.log('Successfully connected to server');
      statusElement.textContent = 'Connected';
      statusElement.style.color = '#4caf50';
      
      // Register as mobile client
      socket.emit('register', { type: 'mobile' });
    });
    
    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      statusElement.textContent = 'Connection failed';
      statusElement.style.color = '#f44336';
    });
    
    socket.on('paired', (data) => {
      if (data.success) {
        isPaired = true;
        statusElement.textContent = 'Paired with desktop';
        statusElement.style.color = '#2196f3';
        
        // Hide pairing controls
        document.querySelector('.pairing').style.display = 'none';
        
        // Add system message
        addMessage('SYSTEM', 'Paired with desktop device', 'system');
        
        // Check microphone access
        checkMicrophoneAccess();
      } else {
        statusElement.textContent = 'Pairing failed';
        statusElement.style.color = '#f44336';
        
        // Add system message
        addMessage('SYSTEM', 'Pairing failed: ' + (data.message || 'Unknown error'), 'system');
      }
    });
    
    socket.on('frequency_active', (data) => {
      isFrequencyActive = data.active;
      
      if (data.active) {
        currentCharacter = data.character;
        activeFrequencyElement.textContent = `Active frequency: ${data.character}`;
        activeFrequencyElement.classList.add('active');
        
        // Enable push-to-talk
        pushToTalkButton.disabled = false;
        
        // Add system message
        addMessage('SYSTEM', `Active frequency detected: ${data.character}`, 'system');
      } else {
        currentCharacter = null;
        activeFrequencyElement.textContent = 'No active frequency';
        activeFrequencyElement.classList.remove('active');
        
        // Disable push-to-talk
        pushToTalkButton.disabled = true;
      }
      
      // Adjust static volume
      if (staticGainNode) {
        const volume = data.active ? 0.1 : 0.7;
        staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
        staticGainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.2);
      }
    });
    
    socket.on('ai_response', (data) => {
      console.log("Received AI response:", data);
      addMessage(data.character, data.message, 'character');
      
      if (data.audioPath) {
        playGeneratedAudio(data.audioPath);
      } else {
        // Fallback to the simulated audio notification
        addMessage('SYSTEM', 'Playing transmission audio (simulated for prototype)', 'system');
      }
    });
    
    socket.on('desktop_disconnected', () => {
      isPaired = false;
      statusElement.textContent = 'Desktop disconnected';
      statusElement.style.color = '#ff9800';
      
      // Show pairing controls again
      document.querySelector('.pairing').style.display = 'flex';
      
      // Disable push-to-talk
      pushToTalkButton.disabled = true;
      
      // Add system message
      addMessage('SYSTEM', 'Desktop device disconnected', 'system');
    });
    
    socket.on('disconnect', () => {
      isPaired = false;
      statusElement.textContent = 'Disconnected';
      statusElement.style.color = '#f44336';
      
      // Add system message
      addMessage('SYSTEM', 'Disconnected from server', 'system');
    });
  }
  
  // Initialize audio context for effects only
  function initAudio() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Don't play static on mobile - create audio context only for effects
      console.log('Audio context created for effects only');
      
      // Create gain node for button sounds
      buttonSoundGainNode = audioContext.createGain();
      buttonSoundGainNode.gain.value = 0.3;
      buttonSoundGainNode.connect(audioContext.destination);
      
      // Set up visualizer with error handling
      try {
        setupAudioVisualizer();
      } catch (vizError) {
        console.error('Visualizer setup failed:', vizError);
      }
      
      return true;
    } catch (error) {
      console.error('Audio initialization failed:', error);
      return false;
    }
  }
  
  // Modern approach using AudioWorkletNode
  async function initAudioWorklet() {
    try {
      // We need to create and load a worklet processor
      const workletBlob = new Blob([`
        class NoiseGenerator extends AudioWorkletProcessor {
          process(inputs, outputs) {
            const output = outputs[0];
            
            for (let channel = 0; channel < output.length; ++channel) {
              const outputChannel = output[channel];
              for (let i = 0; i < outputChannel.length; ++i) {
                // Generate white noise
                outputChannel[i] = Math.random() * 2 - 1;
              }
            }
            
            // Return true to keep the processor alive
            return true;
          }
        }
        
        registerProcessor('noise-generator', NoiseGenerator);
      `], { type: 'application/javascript' });
      
      const workletURL = URL.createObjectURL(workletBlob);
      
      // Load the worklet processor
      await audioContext.audioWorklet.addModule(workletURL);
      
      // Create noise generator
      const noiseNode = new AudioWorkletNode(audioContext, 'noise-generator');
      
      // Create filter to shape noise into more "radio static" sound
      const filter = audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      filter.Q.value = 0.5;
      
      // Connect nodes
      noiseNode.connect(filter);
      filter.connect(staticGainNode);
      staticGainNode.connect(audioContext.destination);
      
      console.log("Using modern AudioWorkletNode for noise generation");
      
      // Clean up the blob URL
      URL.revokeObjectURL(workletURL);
    } catch (error) {
      console.error("Error initializing AudioWorklet:", error);
      // Fall back to legacy method if AudioWorklet fails
      initLegacyNoiseGenerator();
    }
  }
  
  // Legacy approach using ScriptProcessorNode (with deprecation warning)
  function initLegacyNoiseGenerator() {
    console.warn("Using deprecated ScriptProcessorNode. This will be removed in future browser versions.");
    
    const bufferSize = 4096;
    const noiseNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    // Generate white noise
    noiseNode.onaudioprocess = function(e) {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    };
    
    // Create filter to shape noise into more "radio static" sound
    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.5;
    
    // Connect nodes
    noiseNode.connect(filter);
    filter.connect(staticGainNode);
    staticGainNode.connect(audioContext.destination);
    
    // Keep reference to nodes to prevent garbage collection
    window.noiseNode = noiseNode;
    window.staticFilter = filter;
  }
  
  // Add message to the conversation log
  function addMessage(sender, text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const messageInfo = document.createElement('div');
    messageInfo.className = 'message-info';
    messageInfo.textContent = `${sender} | ${new Date().toLocaleTimeString()}`;
    
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = text;
    
    messageDiv.appendChild(messageInfo);
    messageDiv.appendChild(messageText);
    
    messagesElement.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }
  
  // Update setupPushToTalk function to use new button sounds
  function setupPushToTalk() {
    pushToTalkButton.addEventListener('mousedown', (e) => {
      if (!isPaired || !isFrequencyActive) return;
      startTransmitting(e);
      playButtonSound('start');
    });
    
    pushToTalkButton.addEventListener('touchstart', (e) => {
      if (!isPaired || !isFrequencyActive) return;
      startTransmitting(e);
      playButtonSound('start');
    });
    
    pushToTalkButton.addEventListener('mouseup', (e) => {
      if (!isPaired || !isFrequencyActive) return;
      stopTransmitting(e);
      playButtonSound('stop');
    });
    
    pushToTalkButton.addEventListener('touchend', (e) => {
      if (!isPaired || !isFrequencyActive) return;
      stopTransmitting(e);
      playButtonSound('stop');
    });
  }
  
  // Initialize speech recognition
  function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      addMessage('SYSTEM', 'Speech recognition not supported in this browser', 'system');
      return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    
    // Configure for better results
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;  // Get interim results for visual feedback
    speechRecognition.maxAlternatives = 3;    // Look at multiple possible interpretations
    speechRecognition.lang = 'en-US';
    
    // Create visual display for speech
    const speechDisplay = document.createElement('div');
    speechDisplay.className = 'speech-display';
    speechDisplay.innerHTML = '<div class="speech-text"></div><div class="speech-status">Ready</div>';
    document.querySelector('.walkie-talkie').appendChild(speechDisplay);
    
    // Handle interim results for visual feedback
    speechRecognition.onresult = function(event) {
      const speechText = document.querySelector('.speech-text');
      
      // Get the transcript (including interim results)
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Display interim results
      if (interimTranscript) {
        speechText.innerHTML = `<span class="interim">${interimTranscript}</span>`;
      }
      
      // Process final results
      if (finalTranscript) {
        speechText.textContent = finalTranscript;
        
        // Clear any previous timeout
        if (recognitionTimeout) {
          clearTimeout(recognitionTimeout);
        }
        
        // Send the final transcript after a short delay
        recognitionTimeout = setTimeout(() => {
          if (finalTranscript.trim() !== '') {
            addMessage('YOU', finalTranscript, 'user');
            
            if (socket) {
              socket.emit('audio_message', { message: finalTranscript });
            }
          }
        }, 500);
      }
    };
    
    speechRecognition.onerror = function(event) {
      console.error('Speech recognition error:', event.error);
      document.querySelector('.speech-status').textContent = `Error: ${event.error}`;
      document.querySelector('.speech-status').className = 'speech-status error';
      
      if (event.error === 'aborted' || event.error === 'no-speech') {
        // These are common errors, restart recognition after a delay
        setTimeout(() => {
          if (isTransmitting) {
            try {
              speechRecognition.start();
              document.querySelector('.speech-status').textContent = 'Listening...';
              document.querySelector('.speech-status').className = 'speech-status active';
            } catch (e) {
              console.error('Failed to restart speech recognition:', e);
            }
          }
        }, 1000);
      } else {
        addMessage('SYSTEM', `Speech recognition error: ${event.error}`, 'system');
      }
    };
    
    speechRecognition.onstart = function() {
      document.querySelector('.speech-status').textContent = 'Listening...';
      document.querySelector('.speech-status').className = 'speech-status active';
    };
    
    speechRecognition.onend = function() {
      // Only change status if we're not still transmitting
      if (!isTransmitting) {
        document.querySelector('.speech-status').textContent = 'Ready';
        document.querySelector('.speech-status').className = 'speech-status';
      } else {
        // If still transmitting, try to restart recognition
        try {
          speechRecognition.start();
        } catch (e) {
          console.error('Failed to restart speech recognition after end:', e);
        }
      }
    };
    
    return true;
  }
  
  // Initialize audio recording
  async function initAudioRecording() {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create media recorder
      mediaRecorder = new MediaRecorder(stream);
      
      // Set up event handlers
      mediaRecorder.ondataavailable = function(event) {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.onstop = async function() {
        // Create audio blob from chunks
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        
        // Clear chunks for next recording
        audioChunks = [];
      };
      
      return true;
    } catch (error) {
      console.error('Microphone access error:', error);
      addMessage('SYSTEM', 'Could not access microphone. Please check permissions.', 'system');
      return false;
    }
  }
  
  // Add audio visualizer setup
  function setupAudioVisualizer() {
    try {
      // Create canvas for visualizer
      visualizerCanvas = document.createElement('canvas');
      visualizerCanvas.className = 'audio-visualizer';
      visualizerCanvas.width = 150;
      visualizerCanvas.height = 40;
      
      // Add to the interface
      const container = document.createElement('div');
      container.className = 'visualizer-container';
      container.appendChild(visualizerCanvas);
      
      // Find the walkie-talkie element
      const walkieTalkie = document.querySelector('.walkie-talkie');
      if (!walkieTalkie) {
        console.error('Could not find walkie-talkie element');
        return false;
      }
      
      // Find the controls element for positioning
      const controls = document.querySelector('.controls');
      if (controls) {
        walkieTalkie.insertBefore(container, controls);
      } else {
        // Fallback to appending
        walkieTalkie.appendChild(container);
      }
      
      // Get context
      visualizerContext = visualizerCanvas.getContext('2d');
      
      // Initialize visualizer when audio context is ready
      if (audioContext) {
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 32; // Small size for simple visualization
        visualizerData = new Uint8Array(audioAnalyser.frequencyBinCount);
      }
      
      return true;
    } catch (error) {
      console.error('Error setting up audio visualizer:', error);
      return false;
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
  
  // Start audio transmission
  async function startTransmitting(e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent text selection
    
    if (!isPaired || !isFrequencyActive || isTransmitting) {
      console.log("Cannot transmit: ", {isPaired, isFrequencyActive, isTransmitting});
      return;
    }
    
    isTransmitting = true;
    pushToTalkButton.classList.add('active');
    
    // Play button sound instead of static
    playButtonSound('start');
    
    console.log("Starting transmission...");
    
    // Clear previous speech text
    const speechText = document.querySelector('.speech-text');
    if (speechText) speechText.textContent = '';
    
    // Request microphone access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Microphone access granted:", stream);
      
      // Start visualizer
      startAudioVisualization(stream);
      
      // Start speech recognition
      if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        // Create new instance each time to avoid issues
        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = true;
        speechRecognition.maxAlternatives = 3;
        speechRecognition.lang = 'en-US';
        
        // Set up event handlers
        speechRecognition.onstart = function() {
          console.log("Speech recognition started");
          document.querySelector('.speech-status').textContent = 'Listening...';
          document.querySelector('.speech-status').className = 'speech-status active';
        };
        
        speechRecognition.onresult = function(event) {
          console.log("Speech recognition result:", event);
          const speechText = document.querySelector('.speech-text');
          
          // Get the transcript
          let interimTranscript = '';
          let finalTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }
          
          // Display interim results
          if (interimTranscript) {
            speechText.innerHTML = `<span class="interim">${interimTranscript}</span>`;
          }
          
          // Process final results
          if (finalTranscript) {
            speechText.textContent = finalTranscript;
            
            // Send the final transcript
            if (finalTranscript.trim() !== '') {
              addMessage('YOU', finalTranscript, 'user');
              
              if (socket) {
                socket.emit('audio_message', { message: finalTranscript });
                console.log("Sent recognized message:", finalTranscript);
              }
            }
          }
        };
        
        speechRecognition.onerror = function(event) {
          console.error('Speech recognition error:', event.error);
          document.querySelector('.speech-status').textContent = `Error: ${event.error}`;
          document.querySelector('.speech-status').className = 'speech-status error';
          
          // Add fallback message to user
          addMessage('SYSTEM', `Speech recognition error: ${event.error}. Try using text input below.`, 'system');
        };
        
        speechRecognition.onend = function() {
          console.log("Speech recognition ended");
          if (!isTransmitting) {
            document.querySelector('.speech-status').textContent = 'Ready';
            document.querySelector('.speech-status').className = 'speech-status';
          }
        };
        
        try {
          speechRecognition.start();
          console.log("Speech recognition started successfully");
        } catch (error) {
          console.error('Failed to start speech recognition:', error);
          fallbackToTextInput();
        }
      } else {
        console.warn("Speech recognition not supported by this browser");
        fallbackToTextInput();
      }
    } catch (error) {
      console.error('Microphone access error:', error);
      addMessage('SYSTEM', `Microphone error: ${error.message}`, 'system');
      isTransmitting = false;
      pushToTalkButton.classList.remove('active');
      fallbackToTextInput();
    }
  }
  
  // Helper function to fallback to text input
  function fallbackToTextInput() {
    // Prompt for text input
    const userMessage = prompt('Enter your message:');
    
    if (userMessage && userMessage.trim() !== '') {
      console.log("Sending fallback message:", userMessage);
      addMessage('YOU', userMessage, 'user');
      
      if (socket) {
        socket.emit('audio_message', { message: userMessage });
      }
    }
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
  
  // Stop audio transmission
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
  
  // Play radio transmission start/end sounds
  function playTransmissionSound(type) {
    // Use existing audioContext instead of creating a new one
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'start') {
      // Radio "click" sound at start
      oscillator.frequency.value = 1000;
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      setTimeout(() => oscillator.stop(), 100);
    } else {
      // Radio "click" sound at end
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      setTimeout(() => oscillator.stop(), 100);
    }
  }
  
  // Handle pairing
  function setupPairing() {
    pairButton.addEventListener('click', () => {
      const code = pairingCodeInput.value.trim();
      
      if (code && socket) {
        socket.emit('pair', { pairing_code: code });
        addMessage('SYSTEM', 'Attempting to pair with code: ' + code, 'system');
      }
    });
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
  
  // Add microphone status check function
  function checkMicrophoneAccess() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        addMessage('SYSTEM', 'Microphone access granted!', 'system');
        console.log('Microphone stream obtained:', stream);
        
        // Show active tracks
        const tracks = stream.getAudioTracks();
        console.log('Audio tracks:', tracks.length);
        tracks.forEach(track => {
          console.log('Track:', track.label, 'Active:', track.enabled);
        });
        
        // Display a mic indicator
        const indicator = document.createElement('div');
        indicator.className = 'mic-indicator active';
        indicator.textContent = 'MIC ON';
        document.body.appendChild(indicator);
      })
      .catch(error => {
        addMessage('SYSTEM', 'Microphone error: ' + error.message, 'system');
        console.error('Microphone access error:', error);
        
        // Display error indicator
        const indicator = document.createElement('div');
        indicator.className = 'mic-indicator error';
        indicator.textContent = 'MIC ERROR';
        document.body.appendChild(indicator);
      });
  }
  
  // Add button sound functions
  function playButtonSound(type) {
    if (!audioContext) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(buttonSoundGainNode);
    
    if (type === 'start') {
      // Higher pitched "click on" sound
      oscillator.frequency.value = 1200;
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      setTimeout(() => oscillator.stop(), 100);
    } else {
      // Lower pitched "click off" sound
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      setTimeout(() => oscillator.stop(), 100);
    }
  }
  
  // Add this function to mobile.js
  function initSpeechUI() {
    // Create speech display if it doesn't exist
    if (!document.querySelector('.speech-display')) {
      const speechDisplay = document.createElement('div');
      speechDisplay.className = 'speech-display';
      speechDisplay.innerHTML = '<div class="speech-text"></div><div class="speech-status">Ready</div>';
      
      // Find the right place to insert it
      const walkieTalkie = document.querySelector('.walkie-talkie');
      if (walkieTalkie) {
        const controls = document.querySelector('.controls');
        if (controls) {
          walkieTalkie.insertBefore(speechDisplay, controls);
        } else {
          walkieTalkie.appendChild(speechDisplay);
        }
      }
    }
  }
  
  // Initialize the application
  function init() {
    // Add transmission indicator
    const transmissionIndicator = document.createElement('div');
    transmissionIndicator.className = 'transmission-indicator';
    document.querySelector('.walkie-talkie').appendChild(transmissionIndicator);

    // Check for browser compatibility
    const compatibilityCheck = {
      audioContext: !!(window.AudioContext || window.webkitAudioContext),
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    };

    // Log compatibility
    console.log('Browser compatibility:', compatibilityCheck);

    // Warn if features are missing
    if (!compatibilityCheck.audioContext || !compatibilityCheck.mediaDevices) {
      addMessage('SYSTEM', 'Warning: Your browser may not support all audio features. Consider using Chrome for best experience.', 'system');
    }

    if (!compatibilityCheck.speechRecognition) {
      addMessage('SYSTEM', 'Speech recognition not available. Will use text input instead.', 'system');
    }

    // Add initial system message
    addMessage('SYSTEM', 'Walkie-talkie initialized. Connecting to server...', 'system');
    
    // Initialize WebSocket connection
    connectSocket();
    
    // Set up pairing button handler
    setupPairing();
    
    // Set up push-to-talk
    setupPushToTalk();
    
    // Initialize audio on first user interaction
    document.addEventListener('click', () => {
      if (!audioContext) {
        initAudio();
        addMessage('SYSTEM', 'Audio initialized', 'system');
      }
    }, { once: true });
    
    // Initially disable push-to-talk until paired and on active frequency
    pushToTalkButton.disabled = true;
    
    // Add these lines
    addMessage('SYSTEM', 'Initializing audio system...', 'system');
    
    // Request permissions early
    const permissionButton = document.createElement('button');
    permissionButton.textContent = 'Enable Microphone';
    permissionButton.className = 'permission-button';
    permissionButton.onclick = async () => {
      const audioInit = await initAudioRecording();
      const speechInit = initSpeechRecognition();
      
      if (audioInit && speechInit) {
        addMessage('SYSTEM', 'Voice transmission ready.', 'system');
        permissionButton.style.display = 'none';
      } else {
        addMessage('SYSTEM', 'Using text input as fallback.', 'system');
      }
    };
    document.body.appendChild(permissionButton);
    
    // Initialize speech UI
    initSpeechUI();
  }
  
  // Start the application
  init();
});

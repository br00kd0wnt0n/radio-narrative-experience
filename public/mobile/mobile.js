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
  let currentStream = null;
  let currentMediaRecorder = null;
  let visualizerAnimationFrame = null;
  
  // Initialize audio context immediately
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('Audio context initialized');
    
    // Create gain node for button sounds
    buttonSoundGainNode = audioContext.createGain();
    buttonSoundGainNode.gain.value = 0.3;
    buttonSoundGainNode.connect(audioContext.destination);
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
  }

  // Initialize speech recognition immediately
  function initSpeechRecognition() {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      console.log('Speech recognition not supported');
      return false;
    }

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      speechRecognition = new SpeechRecognition();
      speechRecognition.continuous = false;
      speechRecognition.interimResults = true;
      speechRecognition.maxAlternatives = 3;
      speechRecognition.lang = 'en-US';

      speechRecognition.onstart = function() {
        console.log('Speech recognition started');
        const speechStatus = document.querySelector('.speech-status');
        if (speechStatus) {
          speechStatus.textContent = 'Listening...';
          speechStatus.classList.add('active');
          speechStatus.classList.remove('error');
        }
      };

      speechRecognition.onresult = function(event) {
        console.log('Speech recognition result:', event);
        const speechText = document.querySelector('.speech-text');
        if (!speechText) return;

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

        if (interimTranscript) {
          speechText.innerHTML = `<span class="interim">${interimTranscript}</span>`;
        }

        if (finalTranscript) {
          speechText.textContent = finalTranscript;
          if (finalTranscript.trim() !== '' && socket && socket.connected) {
            console.log('Sending message:', finalTranscript);
            addMessage('YOU', finalTranscript, 'user');
            socket.emit('audio_message', { message: finalTranscript });
          }
        }
      };

      speechRecognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        const speechStatus = document.querySelector('.speech-status');
        if (speechStatus) {
          speechStatus.textContent = `Error: ${event.error}`;
          speechStatus.classList.remove('active');
          speechStatus.classList.add('error');
        }
      };

      speechRecognition.onend = function() {
        console.log('Speech recognition ended');
        if (!isTransmitting) {
          const speechStatus = document.querySelector('.speech-status');
          if (speechStatus) {
            speechStatus.textContent = 'Ready';
            speechStatus.classList.remove('active', 'error');
          }
        }
      };

      console.log('Speech recognition initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize speech recognition:', error);
      return false;
    }
  }

  // Initialize speech recognition immediately
  initSpeechRecognition();

  // Request microphone permissions proactively
  async function requestMicrophonePermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone permission granted');
      stream.getTracks().forEach(track => track.stop()); // Stop the stream after getting permission
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      return false;
    }
  }

  // Request microphone permission immediately
  requestMicrophonePermission();

  // Update push-to-talk button setup
  async function setupPushToTalk() {
    console.log('Setting up push-to-talk button');
    
    // Prevent any default touch behaviors on the button
    pushToTalkButton.style.touchAction = 'none';
    pushToTalkButton.style.webkitTouchCallout = 'none';
    pushToTalkButton.style.webkitUserSelect = 'none';
    pushToTalkButton.style.userSelect = 'none';
    
    // Touch events for mobile
    pushToTalkButton.addEventListener('touchstart', async (e) => {
      e.preventDefault();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await startTransmitting(e, stream);
      } catch (error) {
        console.error('Failed to get audio stream:', error);
        addMessage('SYSTEM', 'Failed to access microphone: ' + error.message, 'system');
      }
    }, { passive: false });

    pushToTalkButton.addEventListener('touchend', stopTransmitting);
    pushToTalkButton.addEventListener('touchcancel', stopTransmitting);

    // Mouse events for desktop testing
    pushToTalkButton.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await startTransmitting(e, stream);
      } catch (error) {
        console.error('Failed to get audio stream:', error);
        addMessage('SYSTEM', 'Failed to access microphone: ' + error.message, 'system');
      }
    });

    pushToTalkButton.addEventListener('mouseup', stopTransmitting);
    pushToTalkButton.addEventListener('mouseleave', stopTransmitting);

    // Add visual feedback
    pushToTalkButton.addEventListener('touchstart', () => {
      pushToTalkButton.classList.add('pressed');
    });

    pushToTalkButton.addEventListener('touchend', () => {
      pushToTalkButton.classList.remove('pressed');
    });

    pushToTalkButton.addEventListener('touchcancel', () => {
      pushToTalkButton.classList.remove('pressed');
    });
  }

  // Update startTransmitting function
  async function startTransmitting(e, stream) {
    e.preventDefault();
    e.stopPropagation();

    if (!isPaired || !isFrequencyActive || isTransmitting) {
      console.log('Cannot transmit:', { isPaired, isFrequencyActive, isTransmitting });
      return;
    }

    isTransmitting = true;
    pushToTalkButton.classList.add('active');
    document.querySelector('.transmission-indicator').classList.add('active');

    // Play button sound
    playButtonSound('start');

    console.log('Starting transmission...');

    // Clear previous speech text
    const speechText = document.querySelector('.speech-text');
    if (speechText) speechText.textContent = '';

    try {
      // Resume audio context if it's suspended
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Create source from stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Start visualizer
      if (audioAnalyser) {
        source.connect(audioAnalyser);
        startAudioVisualization();
      }

      // Start speech recognition
      if (speechRecognition) {
        try {
          if (speechRecognition.state === 'listening') {
            speechRecognition.stop();
          }
          speechRecognition.start();
          console.log('Speech recognition started');
        } catch (error) {
          console.error('Speech recognition start error:', error);
          fallbackToTextInput();
        }
      } else {
        console.log('Speech recognition not available, falling back to text input');
        fallbackToTextInput();
      }

      // Start recording with proper MIME type
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const audioChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunks.length === 0) {
          console.log('No audio data recorded');
          return;
        }

        try {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
          const reader = new FileReader();
          
          reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            console.log('Sending audio data, size:', base64Audio.length);
            
            if (socket && socket.connected) {
              socket.emit('audio_message', {
                audio: base64Audio,
                frequency: currentFrequency,
                timestamp: Date.now()
              });
            } else {
              console.error('Socket not connected, cannot send audio');
            }
          };
          
          reader.onerror = (error) => {
            console.error('Error reading audio data:', error);
          };
          
          reader.readAsDataURL(audioBlob);
        } catch (error) {
          console.error('Error processing audio data:', error);
        }
      };

      // Start recording with smaller time slices for more frequent updates
      mediaRecorder.start(100);
      console.log('Started recording');

      // Store references for cleanup
      currentStream = stream;
      currentMediaRecorder = mediaRecorder;

    } catch (error) {
      console.error('Transmission error:', error);
      addMessage('SYSTEM', `Error: ${error.message}`, 'system');
      isTransmitting = false;
      pushToTalkButton.classList.remove('active');
      document.querySelector('.transmission-indicator').classList.remove('active');
    }
  }
  
  // Connect to WebSocket server
  function connectSocket() {
    // Configure Socket.IO with mobile-specific options
    socket = io({
      transports: ['websocket', 'polling'],  // Try WebSocket first, fall back to polling
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true
    });
    
    // Add connection monitoring
    socket.on('connect', () => {
      console.log("Socket connected:", socket.id);
      statusElement.textContent = 'Connected';
      statusElement.style.color = '#4caf50';
      
      // Register as mobile client
      socket.emit('register', { type: 'mobile' });
    });
    
    socket.on('connect_error', (error) => {
      console.error("Socket connection error:", error);
      statusElement.textContent = 'Connection failed';
      statusElement.style.color = '#f44336';
      addMessage('SYSTEM', 'Connection error. Please check your network.', 'system');
      
      // Try to reconnect with polling if WebSocket fails
      if (socket.io.opts.transports[0] === 'websocket') {
        console.log("Falling back to polling transport");
        socket.io.opts.transports = ['polling', 'websocket'];
      }
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log("Reconnection attempt:", attemptNumber);
      statusElement.textContent = `Reconnecting (${attemptNumber}/5)...`;
      statusElement.style.color = '#ff9800';
    });
    
    socket.on('reconnect', (attemptNumber) => {
      console.log("Reconnected after", attemptNumber, "attempts");
      statusElement.textContent = 'Reconnected';
      statusElement.style.color = '#4caf50';
      addMessage('SYSTEM', 'Connection restored', 'system');
    });
    
    socket.on('reconnect_error', (error) => {
      console.error("Reconnection error:", error);
      statusElement.textContent = 'Reconnection failed';
      statusElement.style.color = '#f44336';
    });
    
    socket.on('reconnect_failed', () => {
      console.error("Failed to reconnect");
      statusElement.textContent = 'Connection lost';
      statusElement.style.color = '#f44336';
      addMessage('SYSTEM', 'Connection lost. Please reload the page.', 'system');
    });
    
    socket.on('disconnect', (reason) => {
      console.log("Socket disconnected:", reason);
      statusElement.textContent = 'Disconnected';
      statusElement.style.color = '#f44336';
      
      // Provide more specific guidance based on disconnect reason
      let message = 'Disconnected: ';
      switch (reason) {
        case 'io server disconnect':
          message += 'Server closed the connection. Please reload the page.';
          break;
        case 'io client disconnect':
          message += 'Client disconnected. Please check your network.';
          break;
        case 'ping timeout':
          message += 'Connection timed out. Please check your network.';
          break;
        case 'transport close':
          message += 'Connection closed. Please check your network.';
          break;
        case 'transport error':
          message += 'Connection error. Please check your network.';
          break;
        default:
          message += reason + '. Try reloading.';
      }
      addMessage('SYSTEM', message, 'system');
    });
    
    // Enhanced AI response handling
    socket.on('ai_response', (data) => {
      console.log('Received AI response:', data);
      
      // Handle the response format
      if (data && (data.message || data.text)) {
        // Update UI with the message
        addMessage(data.character || 'AI', data.message || data.text, 'character');
        
        // Play audio if available
        if (data.audioPath) {
          console.log("Playing audio from path:", data.audioPath);
          playGeneratedAudio(data.audioPath);
        } else {
          console.log("No audio path available in response");
        }
      } else {
        console.error('Unexpected response format:', data);
        addMessage('SYSTEM', 'Received invalid response format', 'system');
      }
      
      // Clear speech status
      clearSpeechStatus();
    });
    
    // Add character response handling - only handle if not already handled by ai_response
    socket.on('character_response', (data) => {
      console.log("Received character response:", data);
      
      // Skip if this is an AI response (already handled)
      if (data && data.isAIResponse) {
        console.log('Skipping character_response as this is an AI response');
        return;
      }
      
      if (data && data.message) {
        // Handle direct message format
        addMessage(data.character || 'Unknown', data.message, 'character');
        clearSpeechStatus();

        // Play audio if available in direct format
        if (data.audioPath) {
          console.log("Playing audio from direct path:", data.audioPath);
          playGeneratedAudio(data.audioPath);
        }
      } else {
        console.error("Invalid character response data:", data);
        addMessage('SYSTEM', 'Received invalid response from server', 'system');
      }
    });
    
    // Add error handling
    socket.on('error', (data) => {
      console.error("Socket error:", data);
      if (data && data.message) {
        addMessage('SYSTEM', `Error: ${data.message}`, 'system');
      } else {
        addMessage('SYSTEM', 'An error occurred', 'system');
      }
      
      // Clear any waiting status
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        speechStatus.textContent = 'Error occurred';
        speechStatus.classList.remove('active');
        speechStatus.classList.add('error');
      }
    });
    
    // Add status handling
    socket.on('status', (data) => {
      console.log("Received status:", data);
      if (data && data.data && data.data.status) {
        const status = data.data.status;
        if (status === 'connected') {
          console.log("Socket connected successfully");
        } else if (status === 'disconnected') {
          console.log("Socket disconnected");
          addMessage('SYSTEM', 'Connection lost. Please reload the page.', 'system');
        }
      }
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
  
  // Set up audio visualizer for mobile
  function setupAudioVisualizer() {
    try {
      // Create canvas for visualizer
      visualizerCanvas = document.createElement('canvas');
      visualizerCanvas.width = 200;
      visualizerCanvas.height = 50;
      visualizerCanvas.style.width = '100%';
      visualizerCanvas.style.height = '50px';
      visualizerCanvas.style.backgroundColor = '#222';
      visualizerCanvas.style.borderRadius = '4px';
      visualizerCanvas.style.marginBottom = '10px';
      
      // Insert canvas before messages container
      const messagesContainer = document.getElementById('messages');
      messagesContainer.parentNode.insertBefore(visualizerCanvas, messagesContainer);
      
      // Get canvas context
      visualizerContext = visualizerCanvas.getContext('2d');
      
      // Create analyzer node
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      
      // Create data array for visualization
      visualizerData = new Uint8Array(audioAnalyser.frequencyBinCount);
      
      console.log('Audio visualizer setup complete');
    } catch (error) {
      console.error('Error setting up audio visualizer:', error);
      throw error;
    }
  }
  
  // Start audio visualization
  function startAudioVisualization() {
    if (!audioAnalyser || !visualizerContext) {
      console.error('Audio analyzer or visualizer context not initialized');
      return;
    }

    // Start drawing
    drawVisualizer();
  }
  
  // Draw visualizer
  function drawVisualizer() {
    if (!visualizerCanvas || !visualizerContext || !audioAnalyser) {
      return;
    }

    // Get frequency data
    audioAnalyser.getByteFrequencyData(visualizerData);

    // Clear canvas
    visualizerContext.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    visualizerContext.fillStyle = '#222';
    visualizerContext.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    // Draw bars
    const barWidth = (visualizerCanvas.width / visualizerData.length) * 2.5;
    let x = 0;

    for (let i = 0; i < visualizerData.length; i++) {
      const barHeight = (visualizerData[i] / 255) * visualizerCanvas.height;

      // Use different colors based on frequency
      const hue = (i / visualizerData.length) * 360;
      visualizerContext.fillStyle = `hsl(${hue}, 100%, 50%)`;

      visualizerContext.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }

    // Continue animation if still transmitting
    if (isTransmitting) {
      visualizerAnimationFrame = requestAnimationFrame(drawVisualizer);
    }
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
    
    // Handle different text formats
    if (typeof text === 'object') {
      messageText.textContent = text.message || text.text || JSON.stringify(text);
    } else {
      messageText.textContent = text;
    }
    
    messageDiv.appendChild(messageInfo);
    messageDiv.appendChild(messageText);
    
    messagesElement.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    messagesElement.scrollTop = messagesElement.scrollHeight;
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
    
    // Stop and cleanup recording
    if (currentMediaRecorder && currentMediaRecorder.state !== 'inactive') {
      try {
        currentMediaRecorder.stop();
        console.log('Stopped recording');
      } catch (error) {
        console.error('Error stopping media recorder:', error);
      }
    }
    
    // Stop and cleanup stream
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped audio track');
      });
      currentStream = null;
    }
    
    // Stop visualizer animation
    if (visualizerAnimationFrame) {
      cancelAnimationFrame(visualizerAnimationFrame);
      visualizerAnimationFrame = null;
    }
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
    if (!audioContext) {
      console.error('Audio context not initialized');
      return;
    }
    
    try {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
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
    } catch (error) {
      console.error('Error playing button sound:', error);
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
  
  // Update the pairing code input in mobile.js
  function updatePairingCodeInput() {
    const pairingCodeInput = document.getElementById('pairing-code');
    if (pairingCodeInput) {
      // Set input type to numeric
      pairingCodeInput.type = 'tel'; // 'tel' gives numeric keyboard on most mobile devices
      
      // Add pattern for numeric input
      pairingCodeInput.pattern = '[0-9]*';
      
      // Add inputmode attribute for better mobile support
      pairingCodeInput.inputMode = 'numeric';
      
      // Add maxlength to match the 6-digit code
      pairingCodeInput.maxLength = 6;
      
      // Add placeholder to indicate format
      pairingCodeInput.placeholder = '6-digit code';
      
      // Add auto-complete off to prevent suggestions
      pairingCodeInput.autocomplete = 'off';
      
      console.log("Pairing code input configured for numeric entry");
    }
  }
  
  // Helper function to clear speech status
  function clearSpeechStatus() {
    const speechStatus = document.querySelector('.speech-status');
    if (speechStatus) {
      speechStatus.textContent = '';
      speechStatus.classList.remove('active', 'error');
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
  
  // Play generated audio with radio effect
  function playGeneratedAudio(audioPath) {
    console.log('Playing generated audio:', audioPath);
    
    // Create audio element
    const audio = new Audio(audioPath);
    
    // Add radio effect
    createRadioVoiceEffect(audio);
    
    // Add event listeners
    audio.onplay = () => {
      console.log('Audio playback started');
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        speechStatus.textContent = 'Playing...';
        speechStatus.classList.add('active');
      }
    };
    
    audio.onended = () => {
      console.log('Audio playback ended');
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        speechStatus.textContent = '';
        speechStatus.classList.remove('active');
      }
    };
    
    audio.onerror = (error) => {
      console.error('Audio playback error:', error);
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        speechStatus.textContent = 'Error playing audio';
        speechStatus.classList.add('error');
      }
    };
    
    // Start playback
    audio.play().catch(error => {
      console.error('Error starting audio playback:', error);
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        speechStatus.textContent = 'Error playing audio';
        speechStatus.classList.add('error');
      }
    });
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
    
    // Initialize speech recognition immediately
    if (!speechRecognition) {
      const speechInit = initSpeechRecognition();
      if (speechInit) {
        console.log('Speech recognition initialized');
        addMessage('SYSTEM', 'Speech recognition ready', 'system');
      } else {
        console.log('Speech recognition not available');
        addMessage('SYSTEM', 'Speech recognition not available', 'system');
      }
    }
    
    // Initially disable push-to-talk until paired and on active frequency
    pushToTalkButton.disabled = true;
    
    // Initialize speech UI
    initSpeechUI();
    
    // Request permissions early
    const permissionButton = document.createElement('button');
    permissionButton.textContent = 'Enable Microphone';
    permissionButton.className = 'permission-button';
    permissionButton.onclick = async () => {
      try {
        // Resume audio context if it's suspended
        if (audioContext && audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone permission granted');
        stream.getTracks().forEach(track => track.stop()); // Stop the stream after getting permission
        
        // Initialize audio recording
        const audioInit = await initAudioRecording();
        const speechInit = initSpeechRecognition();
        
        if (audioInit && speechInit) {
          addMessage('SYSTEM', 'Voice transmission ready.', 'system');
          permissionButton.style.display = 'none';
        } else {
          addMessage('SYSTEM', 'Using text input as fallback.', 'system');
        }
      } catch (error) {
        console.error('Microphone permission denied:', error);
        addMessage('SYSTEM', 'Microphone access denied. Please enable permissions.', 'system');
      }
    };
    document.body.appendChild(permissionButton);

    // Update the pairing code input
    updatePairingCodeInput();
  }
  
  // Start the application
  init();
});



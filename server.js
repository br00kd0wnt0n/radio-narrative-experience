// server.js
// Railway deployment trigger - v1.0.1
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const axios = require('axios');
const { Server } = require('socket.io');
const fs = require('fs');

// Set your API key
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY is not set in environment variables');
} else {
  console.log('ElevenLabs API key is set');
}

// Create a direct ElevenLabs API client
const elevenLabsClient = axios.create({
  baseURL: 'https://api.elevenlabs.io/v1',
  headers: {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'audio/mpeg'
  }
});

// Add request interceptor for debugging
elevenLabsClient.interceptors.request.use(request => {
  console.log('Starting Request:', {
    url: request.url,
    method: request.method,
    headers: request.headers
  });
  return request;
});

// Add response interceptor for debugging
elevenLabsClient.interceptors.response.use(
  response => {
    console.log('Response:', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    return response;
  },
  error => {
    if (error.response) {
      console.error('API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
    } else if (error.request) {
      console.error('API Error Request:', error.request);
    } else {
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

// Define voice IDs for each character
const voiceIds = {
  'Commander': '21m00Tcm4TlvDq8ikWAM', // Rachel - authoritative female voice
  'Scientist': 'AZnzlk1XvdvUeBnXmlld', // Domi - intelligent female voice
  'Survivor': 'EXAVITQu4vr4xnSDxMaL',  // Elli - emotional female voice
  'Spy': 'MF3mGyEYCl7XYWbV9V6O',       // Josh - mysterious male voice
  'Pilot': 'pNInz6obpgDQGcFmaJgB',     // Adam - professional male voice
  'Security Officer': 'yoZ06aMxZJJ28mfd3POQ', // Sam - authoritative male voice
  'Doctor': 'flq6f7yk4E4fJM5XTYuZ',    // Nicole - caring female voice
  'Engineer': 'jsCqWAovK2LkecY7zXl4',   // Antoni - technical male voice
  'Director': 'onwK4e9ZLuTAKqWW03F9'    // Matilda - commanding female voice
};

// Create Express app
const app = express();

// Enable CORS for all routes
app.use(cors());

// Serve static files
app.use(express.static('public'));

// Serve Socket.IO client
app.get('/shared/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js'));
});

// Redirect root to desktop by default
app.get('/', (req, res) => {
  res.redirect('/desktop');
});

app.get('/desktop', (req, res) => {
  res.sendFile(__dirname + '/public/desktop/index.html');
});

app.get('/mobile', (req, res) => {
  res.sendFile(__dirname + '/public/mobile/index.html');
});

// Create HTTP server (Railway will provide HTTPS)
const server = http.createServer(app);
console.log('HTTP server created (Railway will provide HTTPS)');

// Initialize Socket.IO with mobile-friendly configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 2048 // Only compress messages larger than 2KB
  },
  maxHttpBufferSize: 1e8 // 100MB
});

// Add connection monitoring
io.engine.on("connection_error", (err) => {
  console.log("Connection error:", err);
});

io.engine.on("connection", (socket) => {
  console.log("New connection established");
});

// Track connected clients
const desktopClients = new Map();
const mobileClients = new Map();

// Track narrative progression
const narrativeState = {
  globalStage: 'discovery', // discovery -> crisis -> resolution
  characterStates: new Map(), // Tracks each character's narrative state
  discoveredCharacters: new Set(), // Tracks which characters have been contacted
  playerKnowledge: new Set(), // Tracks key information pieces discovered
  userDiscoveries: new Map(), // Tracks discoveries per user
  discoveredFrequencies: new Set(), // Tracks all discovered frequencies
  discoveredInfo: {
    'experiment': false,
    'breach': false,
    'creature': false,
    'evacuation': false,
    'government': false,
    'containment': false,
    'radiation': false,
    'mutation': false
  },
  storyProgress: 0, // Track overall story progress (0-100%)
  plotTwistTriggered: false // Track if plot twist has been triggered
};

// Helper function to check narrative progression
function checkNarrativeProgression(socketId) {
  const userDiscoveries = narrativeState.userDiscoveries.get(socketId);
  if (!userDiscoveries) return;
  
  // Count discovered key plot points
  let discoveredKeyPoints = 0;
  let maxDiscoveryOrder = 0;
  
  for (const frequency of userDiscoveries) {
    const freqData = frequencies[frequency];
    if (freqData) {
      if (freqData.discovery_order > maxDiscoveryOrder) {
        maxDiscoveryOrder = freqData.discovery_order;
      }
      discoveredKeyPoints++;
    }
  }
  
  // Update story progress (0-100%)
  narrativeState.storyProgress = Math.min(100, Math.round((maxDiscoveryOrder / 6) * 100));
  
  // Trigger plot twist if 3+ frequencies discovered but not the key one
  if (discoveredKeyPoints >= 3 && !userDiscoveries.has('98.7') && !narrativeState.plotTwistTriggered) {
    narrativeState.plotTwistTriggered = true;
    // Could trigger special event here
  }
}

// Helper function to determine narrative context based on user's discovery history
function determineNarrativeContext(socketId, frequencyData) {
  const userDiscoveries = narrativeState.userDiscoveries.get(socketId);
  if (!userDiscoveries) return "initial";
  
  const discoveredCount = userDiscoveries.size;
  
  // Return different context based on narrative progression
  if (discoveredCount === 1) return "initial";
  if (narrativeState.plotTwistTriggered) return "plot_twist";
  if (discoveredCount > 3) return "advanced";
  return "developing";
}

// Pre-defined radio frequencies and their associated content
const frequencies = {
  '87.5': { 
    character: 'Commander', 
    context: 'mission_control',
    narrative_stage: 'introduction',
    location: 'Command Center Alpha',
    discovery_order: 1
  },
  '92.1': { 
    character: 'Survivor', 
    context: 'wilderness',
    narrative_stage: 'complication',
    location: 'Northern Forest',
    discovery_order: 2
  },
  '98.7': { 
    character: 'Scientist', 
    context: 'laboratory',
    narrative_stage: 'revelation',
    location: 'Research Facility',
    discovery_order: 3
  },
  '104.3': { 
    character: 'Spy', 
    context: 'undercover',
    narrative_stage: 'escalation',
    location: 'Facility Basement',
    discovery_order: 4
  },
  '107.9': { 
    character: 'Pilot', 
    context: 'emergency_landing',
    narrative_stage: 'climax',
    location: 'Airspace Above Site',
    discovery_order: 5
  },
  // New frequencies
  '89.3': {
    character: 'Security Officer',
    context: 'perimeter_breach',
    narrative_stage: 'introduction_alt',
    location: 'Facility Perimeter',
    discovery_order: 1.5
  },
  '95.7': {
    character: 'Doctor',
    context: 'medical_emergency',
    narrative_stage: 'complication_alt',
    location: 'Field Hospital',
    discovery_order: 2.5
  },
  '101.2': {
    character: 'Engineer',
    context: 'power_failure',
    narrative_stage: 'revelation_alt',
    location: 'Power Station',
    discovery_order: 3.5
  },
  '110.5': {
    character: 'Director',
    context: 'evacuation',
    narrative_stage: 'resolution',
    location: 'Emergency Bunker',
    discovery_order: 6
  }
};

// Define standard message formats
const messageFormats = {
  characterResponse: (character, message, stage) => ({
    type: 'character_response',
    data: {
      character,
      message,
      stage,
      timestamp: Date.now()
    }
  }),
  
  error: (message, details = null) => ({
    type: 'error',
    data: {
      message,
      details,
      timestamp: Date.now()
    }
  }),
  
  status: (status, details = {}) => ({
    type: 'status',
    data: {
      status,
      ...details,
      timestamp: Date.now()
    }
  })
};

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id, 'from', socket.handshake.address);
  
  // Set up ping/pong monitoring
  let pingTimeout;
  const heartbeat = () => {
    clearTimeout(pingTimeout);
    pingTimeout = setTimeout(() => {
      console.log(`Client ${socket.id} heartbeat timeout`);
      socket.disconnect(true);
    }, 60000);
  };
  
  socket.on('ping', heartbeat);
  socket.on('pong', heartbeat);
  
  // Client identifies itself as desktop or mobile
  socket.on('register', (data) => {
    if (data.type === 'desktop') {
      const pairing_code = generatePairingCode();
      desktopClients.set(socket.id, { 
        socket, 
        pairing_code,
        current_frequency: null,
        paired_mobile: null,
        lastPing: Date.now()
      });
      socket.emit('registered', { pairing_code });
      console.log(`Desktop registered with code: ${pairing_code} (ID: ${socket.id})`);
    } else if (data.type === 'mobile') {
      mobileClients.set(socket.id, { 
        socket,
        paired_desktop: null,
        lastPing: Date.now()
      });
      socket.emit('registered', { message: 'Mobile registered' });
      console.log(`Mobile registered (ID: ${socket.id})`);
    }
  });
  
  // Mobile client attempts to pair with desktop
  socket.on('pair', (data) => {
    const code = data.pairing_code;
    let desktop = null;
    
    // Find desktop with matching code
    for (const [id, client] of desktopClients.entries()) {
      if (client.pairing_code === code) {
        desktop = client;
        break;
      }
    }
    
    if (desktop) {
      const mobile = mobileClients.get(socket.id);
      if (mobile) {
        // Create the pairing
        desktop.paired_mobile = socket.id;
        mobile.paired_desktop = desktop.socket.id;
        
        // Notify both clients
        socket.emit('paired', { success: true });
        desktop.socket.emit('paired', { success: true });
        console.log(`Paired mobile ${socket.id} with desktop ${desktop.socket.id}`);
      }
    } else {
      socket.emit('paired', { success: false, message: 'Invalid pairing code' });
    }
  });
  
  // Desktop client changes frequency
  socket.on('tune', async (data) => {
    const desktop = desktopClients.get(socket.id);
    if (!desktop) return;
    
    const frequency = data.frequency;
    desktop.current_frequency = frequency;
    
    // Check if this frequency has content
    const frequencyData = frequencies[frequency];
    
    if (frequencyData) {
      // Track frequency discoveries for this user
      if (!narrativeState.userDiscoveries.has(socket.id)) {
        narrativeState.userDiscoveries.set(socket.id, new Set());
      }
      const userDiscoveries = narrativeState.userDiscoveries.get(socket.id);
      
      // First time discovering this frequency
      if (!userDiscoveries.has(frequency)) {
        userDiscoveries.add(frequency);
        narrativeState.discoveredFrequencies.add(frequency);
        
        // Check if this unlocks story progression
        checkNarrativeProgression(socket.id);
      }
      
      // Send frequency data with narrative context to desktop
      socket.emit('frequency_active', { 
        active: true,
        character: frequencyData.character,
        location: frequencyData.location,
        narrativeContext: determineNarrativeContext(socket.id, frequencyData)
      });
      
      // If paired with mobile, also notify mobile
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('frequency_active', { 
            active: true,
            character: frequencyData.character,
            location: frequencyData.location,
            narrativeContext: determineNarrativeContext(socket.id, frequencyData)
          });
        }
      }
    } else {
      // Just static on this frequency
      socket.emit('frequency_active', { active: false });
      
      // If paired with mobile, also notify mobile
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('frequency_active', { active: false });
        }
      }
    }
  });
  
  // Handle audio messages from mobile
  socket.on('audio_message', async (data) => {
    console.log(`Received audio message from ${socket.id}:`, data.message);
    
    // Find the mobile client
    const mobile = mobileClients.get(socket.id);
    if (!mobile || !mobile.paired_desktop) {
      console.log(`Mobile client ${socket.id} is not properly paired`);
      socket.emit('error', { message: 'Not properly paired with desktop' });
      return;
    }
    
    // Find the desktop client
    const desktop = desktopClients.get(mobile.paired_desktop);
    if (!desktop) {
      console.log(`Could not find paired desktop ${mobile.paired_desktop}`);
      socket.emit('error', { message: 'Paired desktop not found' });
      return;
    }
    
    console.log(`Forwarding message to desktop ${desktop.socket.id}`);
    
    try {
      // Validate message format
      if (!data || typeof data.message !== 'string' || data.message.trim() === '') {
        console.error('Invalid message format received:', data);
        const errorMessage = messageFormats.error('Invalid message format');
        socket.emit(errorMessage.type, errorMessage.data);
        return;
      }

      const userMessage = data.message.trim();
      const character = frequencies[desktop.current_frequency].character;
      
      console.log(`Processing message from ${socket.id} to ${character}: "${userMessage}"`);
      
      // Check for key information in the user's message
      const keyInfo = checkForKeyInformation(userMessage, character);
      if (keyInfo) {
        console.log(`Key information discovered: ${keyInfo} by ${character}`);
      }

      // Initialize character state if first contact
      if (!narrativeState.characterStates.has(character)) {
        console.log(`Initializing state for character: ${character}`);
        narrativeState.characterStates.set(character, {
          interactionCount: 0,
          stage: 'introduction',
          lastInteraction: Date.now()
        });
        narrativeState.discoveredCharacters.add(character);
      }
      
      // Update character state
      const characterState = narrativeState.characterStates.get(character);
      characterState.interactionCount++;
      characterState.lastInteraction = Date.now();
      
      // Progress narrative stage based on interaction count
      if (characterState.interactionCount >= 3 && characterState.stage === 'introduction') {
        console.log(`Progressing ${character} to discovery stage`);
        characterState.stage = 'discovery';
      } else if (characterState.interactionCount >= 6 && characterState.stage === 'discovery') {
        console.log(`Progressing ${character} to crisis stage`);
        characterState.stage = 'crisis';
      }
      
      // Advance global narrative if conditions are met
      if (narrativeState.discoveredCharacters.size >= 3 && narrativeState.globalStage === 'discovery') {
        narrativeState.globalStage = 'crisis';
        // Broadcast global event to all connected characters
        broadcastNarrativeEvent('crisis');
      }
      
      // Generate AI response
      const response = await generateAIResponse(userMessage, character, characterState.stage);
      console.log(`Generated response for ${character}: "${response.text}"`);

      // Send response back to both clients using standardized format
      const responseMessage = {
        message: response.text,
        character: character,
        isNarrativeEvent: false,
        isAIResponse: true,
        audioPath: response.audioPath
      };
      
      // Send to both clients
      desktop.socket.emit('ai_response', responseMessage);
      socket.emit('ai_response', responseMessage);
      
      console.log(`AI response sent to desktop ${desktop.socket.id} and mobile ${socket.id}`);
      
    } catch (error) {
      console.error('Error processing audio message:', error);
      const errorMessage = messageFormats.error('Failed to process audio', error.message);
      socket.emit(errorMessage.type, errorMessage.data);
    }
  });
  
  // Add more error handling
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
  
  // Disconnect handling
  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected: ${reason}`);
    
    // If desktop disconnects, notify paired mobile
    if (desktopClients.has(socket.id)) {
      const desktop = desktopClients.get(socket.id);
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('desktop_disconnected');
          console.log(`Notified mobile ${desktop.paired_mobile} of desktop ${socket.id} disconnection`);
        }
      }
      desktopClients.delete(socket.id);
    }
    
    // If mobile disconnects, notify paired desktop
    if (mobileClients.has(socket.id)) {
      const mobile = mobileClients.get(socket.id);
      if (mobile.paired_desktop) {
        const desktopSocket = desktopClients.get(mobile.paired_desktop)?.socket;
        if (desktopSocket) {
          desktopSocket.emit('mobile_disconnected');
          console.log(`Notified desktop ${mobile.paired_desktop} of mobile ${socket.id} disconnection`);
        }
      }
      mobileClients.delete(socket.id);
    }

    const statusMessage = messageFormats.status('disconnected', { socketId: socket.id });
    io.emit(statusMessage.type, statusMessage.data);
  });

  socket.on('connect', () => {
    const statusMessage = messageFormats.status('connected', { socketId: socket.id });
    io.emit(statusMessage.type, statusMessage.data);
  });
});

// Generate a unique pairing code
function generatePairingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Function to generate speech using ElevenLabs
async function generateSpeech(text, voiceId) {
  try {
    console.log(`[generateSpeech] Starting speech generation for text: "${text}" with voice ID: ${voiceId}`);
    console.log('[generateSpeech] Current API key:', apiKey ? 'Set' : 'Not set');
    
    if (!text || !voiceId) {
      console.error('[generateSpeech] Missing required parameters:', { text, voiceId });
      return null;
    }

    if (!apiKey) {
      console.error('[generateSpeech] ElevenLabs API key is not set');
      return null;
    }

    // First, check the user's subscription status
    try {
      const userResponse = await elevenLabsClient.get('/user/subscription');
      console.log('[generateSpeech] User subscription status:', userResponse.data);
      
      if (userResponse.data.character_count === 0) {
        console.error('[generateSpeech] No characters available in subscription');
        return null;
      }
      
      if (userResponse.data.available_characters === 0) {
        console.error('[generateSpeech] No characters remaining in subscription');
        return null;
      }
    } catch (error) {
      console.error('[generateSpeech] Error checking subscription:', error.message);
      // Continue anyway, as the API might still work
    }

    console.log('[generateSpeech] Calling ElevenLabs API...');
    
    // Make the API call directly
    const response = await elevenLabsClient.post(`/text-to-speech/${voiceId}`, {
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.75
      }
    }, {
      responseType: 'arraybuffer',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      }
    });
    
    if (!response || !response.data) {
      console.error('[generateSpeech] No response from ElevenLabs API');
      return null;
    }
    
    console.log('[generateSpeech] Received response from ElevenLabs API');
    
    // Create a unique filename for this audio
    const timestamp = Date.now();
    const filename = `${timestamp}.mp3`;
    const dir = path.join(__dirname, 'public', 'generated');
    const filePath = path.join(dir, filename);
    
    console.log(`[generateSpeech] Will save audio to: ${filePath}`);
    
    // Ensure the directory exists
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      console.log(`[generateSpeech] Ensured directory exists: ${dir}`);
    } catch (error) {
      console.error('[generateSpeech] Error creating directory:', error);
      return null;
    }
    
    // Save the file
    try {
      console.log('[generateSpeech] Saving audio file...');
      await fs.promises.writeFile(filePath, response.data);
      console.log(`[generateSpeech] Audio file saved successfully at: ${filePath}`);
      
      // Verify the file exists and is not empty
      const stats = await fs.promises.stat(filePath);
      console.log(`[generateSpeech] File size: ${stats.size} bytes`);
      if (stats.size === 0) {
        console.error('[generateSpeech] Generated audio file is empty');
        return null;
      }
      
      // Return just the filename, not the full path
      const result = { filename };
      console.log('[generateSpeech] Returning result:', result);
      return result;
    } catch (error) {
      console.error('[generateSpeech] Error saving audio file:', error);
      return null;
    }
  } catch (error) {
    console.error("[generateSpeech] Error generating speech:", error);
    if (error.response) {
      console.error("[generateSpeech] API Error details:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
      
      // Check for specific error cases
      if (error.response.status === 401) {
        if (error.response.data && error.response.data.detail) {
          console.error("[generateSpeech] Authentication error:", error.response.data.detail);
        } else {
          console.error("[generateSpeech] Authentication error - please check your API key and subscription status");
        }
      } else if (error.response.status === 429) {
        console.error("[generateSpeech] Rate limit exceeded or insufficient credits");
      }
    }
    return null;
  }
}

// Function to check for key information in messages
function checkForKeyInformation(message, character) {
  const lowerMsg = message.toLowerCase();
  
  // Experiment information
  if ((character === 'Scientist' || character === 'Engineer') && 
      (lowerMsg.includes('experiment') || lowerMsg.includes('test') || lowerMsg.includes('research'))) {
    narrativeState.discoveredInfo.experiment = true;
    return 'experiment';
  }
  
  // Breach information
  if ((character === 'Commander' || character === 'Security Officer') && 
      (lowerMsg.includes('breach') || lowerMsg.includes('containment') || lowerMsg.includes('security'))) {
    narrativeState.discoveredInfo.breach = true;
    return 'breach';
  }
  
  // Creature information
  if ((character === 'Survivor' || character === 'Security Officer') && 
      (lowerMsg.includes('creature') || lowerMsg.includes('monster') || lowerMsg.includes('entity'))) {
    narrativeState.discoveredInfo.creature = true;
    return 'creature';
  }
  
  // Evacuation information
  if ((character === 'Commander' || character === 'Pilot') && 
      (lowerMsg.includes('evacuate') || lowerMsg.includes('extraction') || lowerMsg.includes('rescue'))) {
    narrativeState.discoveredInfo.evacuation = true;
    return 'evacuation';
  }
  
  // Government involvement
  if ((character === 'Spy' || character === 'Scientist') && 
      (lowerMsg.includes('government') || lowerMsg.includes('classified') || lowerMsg.includes('project'))) {
    narrativeState.discoveredInfo.government = true;
    return 'government';
  }
  
  // Containment issues
  if ((character === 'Scientist' || character === 'Engineer') && 
      (lowerMsg.includes('containment') || lowerMsg.includes('field') || lowerMsg.includes('barrier'))) {
    narrativeState.discoveredInfo.containment = true;
    return 'containment';
  }
  
  // Radiation effects
  if ((character === 'Scientist' || character === 'Doctor') && 
      (lowerMsg.includes('radiation') || lowerMsg.includes('exposure') || lowerMsg.includes('effects'))) {
    narrativeState.discoveredInfo.radiation = true;
    return 'radiation';
  }
  
  // Mutation information
  if ((character === 'Survivor' || character === 'Doctor') && 
      (lowerMsg.includes('mutation') || lowerMsg.includes('change') || lowerMsg.includes('transform'))) {
    narrativeState.discoveredInfo.mutation = true;
    return 'mutation';
  }
}

// Update the generateAIResponse function
async function generateAIResponse(userMessage, character, characterStage) {
  try {
    console.log(`[generateAIResponse] Starting response generation for ${character} in ${characterStage} stage`);
    
    let responseText = '';
    
    // Check for cross-character references (30% chance)
    if (Math.random() < 0.3) {
      console.log(`[generateAIResponse] Checking cross-character references for ${character}`);
      // Commander references
      if (character === 'Commander' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          responseText = "The scientists were playing with forces they didn't understand. Now we're all paying the price.";
        } else if (narrativeState.discoveredInfo.creature) {
          responseText = "If what the survivor reported is true, we need to adjust our containment strategy immediately.";
        }
      }
      
      // Scientist references
      if (character === 'Scientist' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.breach) {
          responseText = "You spoke with security? Then you know about the containment breach. It's worse than they realize.";
        } else if (narrativeState.discoveredInfo.government) {
          responseText = "The classified nature of this project... it's why we weren't prepared for this scale of failure.";
        }
      }
      
      // Survivor references
      if (character === 'Survivor' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          responseText = "So that's what they were doing in the facility... no wonder everything's changing.";
        } else if (narrativeState.discoveredInfo.radiation) {
          responseText = "The doctor mentioned radiation... that explains why the animals are acting so strange.";
        }
      }
      
      // Spy references
      if (character === 'Spy' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.government) {
          responseText = "The government's involvement goes deeper than we thought. This was never just a research facility.";
        } else if (narrativeState.discoveredInfo.evacuation) {
          responseText = "The commander's evacuation order... it's a cover. They're planning something else.";
        }
      }
      
      // Pilot references
      if (character === 'Pilot' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.containment) {
          responseText = "The containment field the scientists mentioned... it's affecting our instruments. We can't maintain altitude!";
        } else if (narrativeState.discoveredInfo.mutation) {
          responseText = "The doctor's reports about mutations... I'm seeing things in the clouds that shouldn't be possible.";
        }
      }
    }
    
    // If no cross-character response was generated, use stage-specific responses
    if (!responseText) {
      console.log(`[generateAIResponse] Using stage-specific response for ${character} in ${characterStage}`);
      const stageResponses = {
        'Commander': {
          'introduction': [
            "This is Command Center Alpha. We've detected your signal.",
            "Special operations command here. Identify yourself and state your situation.",
            "We've been monitoring this frequency. Report your status immediately."
          ],
          'revelation': [
            "Our scientists warned this might happen. The experiment was never supposed to go this far.",
            "We've lost contact with three teams already. Whatever's happening is spreading.",
            "The energy signatures match nothing in our database. This is beyond anything we've encountered."
          ],
          'crisis': [
            "All units fall back to containment perimeter. This is not a drill. Repeat, fall back immediately.",
            "The phenomenon is expanding exponentially. We need to evacuate all personnel within a 5-mile radius.",
            "Military protocol has been authorized. Anyone showing signs of exposure must be quarantined."
          ]
        },
        'Scientist': {
          'introduction': [
            "Hello? Is anyone receiving? This is Dr. Chen from the research facility.",
            "Can anyone hear me? The containment systems are showing unusual readings.",
            "This is an emergency broadcast. We need immediate assistance at the facility."
          ],
          'revelation': [
            "The quantum field experiment... it's creating anomalies we can't control.",
            "The readings are off the charts. The containment field is becoming unstable.",
            "We need to shut down the experiment, but the system won't respond to our commands."
          ],
          'crisis': [
            "The containment field is collapsing! The anomaly is spreading through the facility!",
            "We've lost control of the experiment. The quantum field is merging with our reality.",
            "The facility's structure is changing. The walls... they're not solid anymore."
          ]
        },
        'Survivor': {
          'introduction': [
            "Hello? Is anyone out there? I've been alone for days...",
            "Please... if anyone can hear this... I need help.",
            "The forest... something's wrong with the forest."
          ],
          'revelation': [
            "The animals... they're different now. More aggressive, more... intelligent.",
            "I saw something in the trees last night. It wasn't human...",
            "The plants are moving. Growing in ways they shouldn't be able to."
          ],
          'crisis': [
            "The forest is alive! It's changing everything it touches!",
            "I can see the facility from here. The air around it... it's warping reality.",
            "The trees are closing in. I don't know how much longer I can survive out here."
          ]
        },
        'Spy': {
          'introduction': [
            "This channel secure? I've found something... unusual.",
            "Agent Black reporting. The facility's security is more extensive than briefed.",
            "Need to keep this brief. Security patrols are increasing."
          ],
          'revelation': [
            "The facility's purpose... it's not what we were told. They're not just researching.",
            "Found classified documents. The project goes back decades. Military involvement.",
            "The experiments... they're trying to manipulate reality itself."
          ],
          'crisis': [
            "Security systems are failing! The facility is going into lockdown!",
            "The containment breach... it's affecting the security systems. They're becoming... alive.",
            "Need extraction immediately. The facility is transforming into something else."
          ]
        },
        'Pilot': {
          'introduction': [
            "Mayday! Mayday! This is Echo-7, requesting immediate assistance!",
            "Echo-7 to any station, do you read? Over.",
            "This is Echo-7, declaring emergency. Over."
          ],
          'revelation': [
            "Instruments going haywire. Something's interfering with our systems.",
            "Weather radar showing impossible readings. Like nothing I've ever seen.",
            "The airspace around the facility... it's warping our instruments."
          ],
          'crisis': [
            "Mayday! Mayday! Something's pulling us down! Can't maintain altitude!",
            "The sky... it's changing. The clouds are forming impossible patterns.",
            "We're caught in some kind of... gravity well. Can't break free!"
          ]
        }
      };
      
      const responses = stageResponses[character]?.[characterStage];
      if (responses && responses.length > 0) {
        responseText = responses[Math.floor(Math.random() * responses.length)];
      }
    }
    
    // If still no response, use default character responses
    if (!responseText) {
      console.log(`[generateAIResponse] Using default response for ${character}`);
      const defaultResponses = {
        'Commander': "Command Center Alpha. State your situation.",
        'Scientist': "This is Dr. Chen. The containment systems are showing unusual readings.",
        'Survivor': "Hello? Is anyone out there? I've been alone for days...",
        'Spy': "This channel secure? I've found something... unusual.",
        'Pilot': "Mayday! Mayday! This is Echo-7, requesting immediate assistance!"
      };
      responseText = defaultResponses[character] || "Radio static... transmission lost...";
    }
    
    console.log(`[generateAIResponse] Final response text: "${responseText}"`);
    
    // Generate audio for the response
    console.log(`[generateAIResponse] Getting voice ID for ${character}`);
    const voiceId = voiceIds[character] || voiceIds['Commander'];
    console.log(`[generateAIResponse] Using voice ID: ${voiceId}`);
    
    console.log(`[generateAIResponse] Calling generateSpeech with text: "${responseText}" and voice ID: ${voiceId}`);
    const audioResult = await generateSpeech(responseText, voiceId);
    console.log(`[generateAIResponse] Audio generation result:`, audioResult);
    
    const result = {
      text: responseText,
      audioPath: audioResult ? `/generated/${audioResult.filename}` : null
    };
    console.log(`[generateAIResponse] Final response object:`, result);
    
    return result;
  } catch (error) {
    console.error("[generateAIResponse] Error generating AI response:", error);
    return {
      text: "Radio static... transmission lost...",
      audioPath: null
    };
  }
}

// Function to broadcast narrative events to all connected characters
function broadcastNarrativeEvent(eventType) {
  // For each connected desktop client
  for (const [id, desktop] of desktopClients.entries()) {
    if (desktop.current_frequency && frequencies[desktop.current_frequency]) {
      const character = frequencies[desktop.current_frequency].character;
      
      let eventMessage = '';
      if (eventType === 'crisis') {
        // Character-specific crisis messages
        if (character === 'Commander') {
          eventMessage = "ALERT: Multiple breaches detected! All field teams report in immediately!";
        } else if (character === 'Scientist') {
          eventMessage = "The containment field is collapsing! We're out of time!";
        } else if (character === 'Survivor') {
          eventMessage = "The forest... it's changing faster now. The trees are moving!";
        } else if (character === 'Spy') {
          eventMessage = "Security systems are failing! The facility is going into lockdown!";
        } else if (character === 'Pilot') {
          eventMessage = "Mayday! Mayday! Something's pulling us down! Can't maintain altitude!";
        }
      }
      
      if (eventMessage) {
        // Send to desktop
        desktop.socket.emit('ai_response', {
          message: eventMessage,
          character: character,
          isNarrativeEvent: true
        });
        
        // Send to paired mobile if exists
        if (desktop.paired_mobile) {
          const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
          if (mobileSocket) {
            mobileSocket.emit('ai_response', {
              message: eventMessage,
              character: character,
              isNarrativeEvent: true
            });
          }
        }
      }
    }
  }
}

// Handle audio data upload
app.post('/upload-audio', (req, res) => {
  // Process the audio data
  // This would require additional middleware like multer
  // For now, we'll rely on client-side speech recognition
  res.status(501).json({ 
    message: 'Audio upload not implemented yet. Using speech recognition instead.',
    status: 'not_implemented'
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
const isProduction = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_SERVICE_NAME;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  
  if (isProduction) {
    // We're on Railway, use the public URL
    const baseUrl = process.env.RAILWAY_STATIC_URL || 'your Railway URL';
    console.log(`App deployed! Access it at ${baseUrl}`);
    console.log(`Desktop interface: ${baseUrl}/desktop`);
    console.log(`Mobile interface: ${baseUrl}/mobile`);
  } else {
    // Local development
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const localIP = Object.values(nets)
      .flat()
      .find(ip => ip.family === 'IPv4' && !ip.internal)?.address || 'localhost';

    const protocol = server instanceof https.Server ? 'https' : 'http';
    console.log(`Desktop interface: ${protocol}://localhost:${PORT}/desktop`);
    console.log(`Mobile interface: ${protocol}://${localIP}:${PORT}/mobile`);
  }
});
// server.js
// Railway deployment trigger - v1.0.1
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const elevenLabs = require('elevenlabs-js');

// Set your API key
elevenLabs.setApiKey(process.env.ELEVENLABS_API_KEY);

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

// Initialize Socket.IO with the server
const io = socketIo(server);

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

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id, 'from', socket.handshake.address);
  
  // Client identifies itself as desktop or mobile
  socket.on('register', (data) => {
    if (data.type === 'desktop') {
      const pairing_code = generatePairingCode();
      desktopClients.set(socket.id, { 
        socket, 
        pairing_code,
        current_frequency: null,
        paired_mobile: null
      });
      socket.emit('registered', { pairing_code });
      console.log(`Desktop registered with code: ${pairing_code} (ID: ${socket.id})`);
    } else if (data.type === 'mobile') {
      mobileClients.set(socket.id, { 
        socket,
        paired_desktop: null
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
    const mobile = mobileClients.get(socket.id);
    if (!mobile || !mobile.paired_desktop) return;
    
    const desktop = desktopClients.get(mobile.paired_desktop);
    if (!desktop) return;
    
    // Get current frequency data
    const frequency = desktop.current_frequency;
    const frequencyData = frequencies[frequency];
    
    if (frequencyData) {
      try {
        const userMessage = data.message;
        const character = frequencyData.character;
        
        // Check for key information in the user's message
        checkForKeyInformation(userMessage, character);
        
        // Initialize character state if first contact
        if (!narrativeState.characterStates.has(character)) {
          narrativeState.characterStates.set(character, {
            stage: 'introduction',
            interactionCount: 0,
            keyInfoRevealed: false
          });
          narrativeState.discoveredCharacters.add(character);
        }
        
        // Update character state
        const charState = narrativeState.characterStates.get(character);
        charState.interactionCount++;
        
        // Progress narrative stages based on interaction count and discoveries
        if (charState.interactionCount >= 3 && charState.stage === 'introduction') {
          charState.stage = 'revelation';
        } else if (charState.interactionCount >= 6 && charState.stage === 'revelation') {
          charState.stage = 'crisis';
        }
        
        // Advance global narrative if conditions are met
        if (narrativeState.discoveredCharacters.size >= 3 && narrativeState.globalStage === 'discovery') {
          narrativeState.globalStage = 'crisis';
          // Broadcast global event to all connected characters
          broadcastNarrativeEvent('crisis');
        }
        
        // Generate AI response with narrative context
        const aiResponse = await generateAIResponse(
          userMessage, 
          character, 
          frequencyData.context,
          charState.stage,
          narrativeState.globalStage
        );
        
        // Send the AI response back to both desktop and mobile
        desktop.socket.emit('ai_response', { 
          message: aiResponse.text,
          character: frequencyData.character,
          audioPath: aiResponse.audioPath,
          narrativeStage: charState.stage
        });
        
        socket.emit('ai_response', { 
          message: aiResponse.text,
          character: frequencyData.character,
          audioPath: aiResponse.audioPath,
          narrativeStage: charState.stage
        });
        
      } catch (error) {
        console.error('Error processing audio message:', error);
        socket.emit('error', { message: 'Failed to process audio' });
      }
    }
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id, 'from', socket.handshake.address);
    
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
  });
});

// Generate a unique pairing code
function generatePairingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Function to generate speech using ElevenLabs
async function generateSpeech(text, voiceId) {
  try {
    const response = await elevenLabs.textToSpeech(
      voiceId, 
      text, 
      "eleven_multilingual_v2", 
      {
        stability: 0.75,
        similarity_boost: 0.75
      }
    );
    
    // Create a unique filename for this audio
    const timestamp = Date.now();
    const filename = `${timestamp}.mp3`;
    const filePath = `public/generated/${filename}`;
    
    // Ensure the directory exists
    const fs = require('fs');
    const dir = 'public/generated';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Save the file
    await response.saveFile(filePath);
    
    return {
      filePath,
      filename
    };
  } catch (error) {
    console.error("Error generating speech:", error);
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
  }
  
  // Breach information
  if ((character === 'Commander' || character === 'Security Officer') && 
      (lowerMsg.includes('breach') || lowerMsg.includes('containment') || lowerMsg.includes('security'))) {
    narrativeState.discoveredInfo.breach = true;
  }
  
  // Creature information
  if ((character === 'Survivor' || character === 'Security Officer') && 
      (lowerMsg.includes('creature') || lowerMsg.includes('monster') || lowerMsg.includes('entity'))) {
    narrativeState.discoveredInfo.creature = true;
  }
  
  // Evacuation information
  if ((character === 'Commander' || character === 'Pilot') && 
      (lowerMsg.includes('evacuate') || lowerMsg.includes('extraction') || lowerMsg.includes('rescue'))) {
    narrativeState.discoveredInfo.evacuation = true;
  }
  
  // Government involvement
  if ((character === 'Spy' || character === 'Scientist') && 
      (lowerMsg.includes('government') || lowerMsg.includes('classified') || lowerMsg.includes('project'))) {
    narrativeState.discoveredInfo.government = true;
  }
  
  // Containment issues
  if ((character === 'Scientist' || character === 'Engineer') && 
      (lowerMsg.includes('containment') || lowerMsg.includes('field') || lowerMsg.includes('barrier'))) {
    narrativeState.discoveredInfo.containment = true;
  }
  
  // Radiation effects
  if ((character === 'Scientist' || character === 'Doctor') && 
      (lowerMsg.includes('radiation') || lowerMsg.includes('exposure') || lowerMsg.includes('effects'))) {
    narrativeState.discoveredInfo.radiation = true;
  }
  
  // Mutation information
  if ((character === 'Survivor' || character === 'Doctor') && 
      (lowerMsg.includes('mutation') || lowerMsg.includes('change') || lowerMsg.includes('transform'))) {
    narrativeState.discoveredInfo.mutation = true;
  }
}

// Update the generateAIResponse function
async function generateAIResponse(userMessage, character, context, characterStage, globalStage) {
  try {
    console.log(`Generating response for ${character} in ${characterStage} stage, global: ${globalStage}`);
    
    // Check for cross-character references (30% chance)
    if (Math.random() < 0.3) {
      // Commander references
      if (character === 'Commander' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          return "The scientists were playing with forces they didn't understand. Now we're all paying the price.";
        }
        if (narrativeState.discoveredInfo.creature) {
          return "If what the survivor reported is true, we need to adjust our containment strategy immediately.";
        }
      }
      
      // Scientist references
      if (character === 'Scientist' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.breach) {
          return "You spoke with security? Then you know about the containment breach. It's worse than they realize.";
        }
        if (narrativeState.discoveredInfo.government) {
          return "The classified nature of this project... it's why we weren't prepared for this scale of failure.";
        }
      }
      
      // Survivor references
      if (character === 'Survivor' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          return "So that's what they were doing in the facility... no wonder everything's changing.";
        }
        if (narrativeState.discoveredInfo.radiation) {
          return "The doctor mentioned radiation... that explains why the animals are acting so strange.";
        }
      }
      
      // Spy references
      if (character === 'Spy' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.government) {
          return "The government's involvement goes deeper than we thought. This was never just a research facility.";
        }
        if (narrativeState.discoveredInfo.evacuation) {
          return "The commander's evacuation order... it's a cover. They're planning something else.";
        }
      }
      
      // Pilot references
      if (character === 'Pilot' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.containment) {
          return "The containment field the scientists mentioned... it's affecting our instruments. We can't maintain altitude!";
        }
        if (narrativeState.discoveredInfo.mutation) {
          return "The doctor's reports about mutations... I'm seeing things in the clouds that shouldn't be possible.";
        }
      }
    }
    
    // Convert user message to lowercase for easier matching
    const message = userMessage.toLowerCase();
    
    // Stage-specific responses
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
    
    // Character-specific contextual responses
    const contextualResponses = {
      'Commander': {
        // Greetings
        'hello': ["Intel suggests unusual activity in sector 7. Satellite data shows energy signatures we can't identify.", 
                 "Initial reports indicate a research facility breach. All contact lost 48 hours ago."],
        'hi': ["This is a secure channel. State your clearance level.", "Command Center Alpha. Identify yourself."],
        
        // Questions
        'what': ["Intel suggests unusual activity in sector 7. Satellite data shows energy signatures we can't identify.", 
                 "Initial reports indicate a research facility breach. All contact lost 48 hours ago."],
        'where': ["Your coordinates show you're 3 clicks south of the anomaly zone. Proceed with caution.", 
                  "You're at the edge of our sensor range. Can barely maintain this signal."],
        'who': ["This is Commander Reynolds. I'm coordinating this operation from base.", 
                "Need-to-know basis only. Focus on your mission parameters."],
        
        // Status requests
        'status': ["Situation critical. We've lost contact with three recon teams already.", 
                   "Alert level raised to maximum. Military cordon established 10 miles out."],
        'report': ["Atmospheric readings show increasing radiation levels. Whatever's happening is accelerating.", 
                   "Last team reported visual distortions and equipment failures before we lost contact."],
        
        // Directives
        'help': ["Backup is en route. ETA 20 minutes. Hold your position.", 
                 "Extraction team dispatched. Signal your location with the emergency beacon."],
        'should i': ["Maintain observation only. Do NOT engage. Repeat, do NOT engage.", 
                     "Collect data if possible, but your safety is priority. Retreat at first sign of danger."]
      },
      
      'Scientist': {
        // Greetings
        'hello': ["*cough* Is someone there? Thank god—I've been trying to reach anyone for hours.", 
                  "Who is this? Are you with the rescue team?"],
        'hi': ["Can anyone hear me? The containment field is failing!", 
               "Is this channel secure? I need to report a critical situation."],
        
        // Questions
        'what': ["The experiment... it created some kind of tear in—I don't know how to describe it. Reality itself.", 
                 "We were studying quantum field stability when the containment failed. Something came through."],
        'how': ["Everything happened so fast. The readings went off the scale, then the barriers just... collapsed.", 
                "I'm not sure we can stop it now. The reaction has become self-sustaining."],
        'why': ["We didn't know what we were dealing with. The government pushed for results without proper testing.", 
                "The energy potential was too promising to ignore. Corporate funding pressured us to accelerate."],
        'where': ["I'm locked in the auxiliary lab. Level B3. The main facility is... compromised.", 
                  "I can see it spreading through the walls. The structure is becoming... something else."]
      },
      
      'Survivor': {
        // Greetings
        'hello': ["*static* Hello? Is anyone out there? *cough*", 
                  "Please... if anyone can hear this... I need help."],
        'hi': ["*heavy breathing* Who's there? I've been alone for days...", 
               "Can anyone hear me? The forest... it's not safe anymore."],
        
        // Questions
        'what': ["I saw something in the trees last night. It wasn't human...", 
                 "The animals... they're different now. More aggressive, more... intelligent."],
        'where': ["I'm in the old ranger station. The main building collapsed yesterday.", 
                  "Near the northern ridge. The signal's weak, but I can see the facility from here."],
        'help': ["I'm running low on supplies. The water's contaminated...", 
                 "My leg... I think it's infected. Can't walk much further."]
      },
      
      'Spy': {
        // Greetings
        'hello': ["*whispering* This channel secure? I've found something...", 
                  "Agent Black reporting. Situation more complex than briefed."],
        'hi': ["*static* Need to keep this brief. Security patrols increasing.", 
               "This is a secure line? I have intel that can't wait."],
        
        // Questions
        'what': ["The facility's purpose... it's not what we were told. They're not just researching.", 
                 "Found classified documents. The project goes back decades. Military involvement."],
        'where': ["Main server room. Bypassed security, but can't stay long.", 
                  "Underground level. The deeper I go, the stranger it gets."],
        'help': ["Need extraction plan. Security AI adapting to my patterns.", 
                 "Cover compromised. Need new identity and exit strategy."]
      },
      
      'Pilot': {
        // Greetings
        'hello': ["Mayday! Mayday! This is Echo-7, requesting immediate assistance!", 
                  "Echo-7 to any station, do you read? Over."],
        'hi': ["*static* Can anyone hear me? Systems failing!", 
               "This is Echo-7, declaring emergency. Over."],
        
        // Questions
        'what': ["Instruments going haywire. Something's interfering with our systems.", 
                 "Weather radar showing impossible readings. Like nothing I've ever seen."],
        'where': ["Approaching the facility's airspace. Altitude 5000 feet.", 
                  "Circling the anomaly zone. Can't maintain stable flight path."],
        'help': ["Need emergency landing coordinates. Fuel running low.", 
                 "Requesting ground control. Navigation systems compromised."]
      }
    };
    
    // Check if there's a contextual response available
    let responses = [];
    if (contextualResponses[character]) {
      // Look for keywords in the user message
      for (const [keyword, respList] of Object.entries(contextualResponses[character])) {
        if (message.includes(keyword)) {
          responses = respList;
          break;
        }
      }
    }
    
    // If no keyword match, use stage-specific response
    if (responses.length === 0 && stageResponses[character] && stageResponses[character][characterStage]) {
      responses = stageResponses[character][characterStage];
    }
    
    // If still no match, fall back to default responses
    if (responses.length === 0) {
      // Default character responses
      const characterResponses = {
        'Commander': [
          "Copy that. We're tracking your position.",
          "Maintain radio silence until further notice.",
          "Satellite imagery shows movement in your sector.",
          "We have reports of unusual activity. Proceed with caution.",
          "Roger that. The situation is developing rapidly.",
          "Be advised: we're sending backup to your location."
        ],
        'Survivor': [
          "I've been out here for days... supplies are running low.",
          "The forest... it's not like it used to be.",
          "Can anyone hear me? I need help...",
          "I saw something in the trees last night.",
          "My radio's been acting strange...",
          "There's a facility... I think it's abandoned."
        ],
        'Scientist': [
          "The readings are off the charts!",
          "We need to contain this immediately.",
          "The experiment has unexpected side effects.",
          "I've never seen anything like this before.",
          "The containment field is weakening.",
          "We need to evacuate the facility."
        ],
        'Spy': [
          "I'm in position. No one suspects a thing.",
          "The security system has a backdoor.",
          "I've found classified documents.",
          "Something's not right here...",
          "I need extraction, now!",
          "The facility is more than it seems."
        ],
        'Pilot': [
          "Mayday! Mayday! We're losing altitude!",
          "The instruments are malfunctioning.",
          "I see the facility below.",
          "Something's interfering with our systems.",
          "We need to land immediately!",
          "The airspace is restricted."
        ]
      };
      
      responses = characterResponses[character] || ["Radio static... can't make out what they're saying..."];
    }
    
    // Select a random response from the matched responses
    const randomIndex = Math.floor(Math.random() * responses.length);
    const textResponse = responses[randomIndex];
    
    // Get the voice ID for this character
    const voiceId = voiceIds[character] || voiceIds['Commander'];
    
    // Generate audio using ElevenLabs
    console.log(`Generating audio for response: "${textResponse}"`);
    const audioResult = await generateSpeech(textResponse, voiceId);
    
    if (!audioResult) {
      throw new Error("Failed to generate audio");
    }
    
    // Return both text and audio information
    return {
      text: textResponse,
      audioPath: `/generated/${audioResult.filename}`
    };
  } catch (error) {
    console.error("Error generating AI response:", error);
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
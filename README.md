# Radio Narrative Experience

An interactive radio-based narrative experience where users can communicate with different characters through a simulated radio interface.

## Features

- Real-time communication between desktop and mobile interfaces
- Dynamic character responses based on narrative progression
- Voice synthesis using ElevenLabs
- Cross-character information sharing
- Progressive narrative stages
- Multiple character interactions

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- ElevenLabs API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/radio-narrative-experience.git
cd radio-narrative-experience
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
ELEVENLABS_API_KEY=your_api_key_here
PORT=3000
```

## Running the Application

1. Start the server:
```bash
npm start
```

2. Access the interfaces:
- Desktop: http://localhost:3000/desktop
- Mobile: http://your_local_ip:3000/mobile

## Project Structure

- `/public` - Static files and client-side code
  - `/desktop` - Desktop interface files
  - `/mobile` - Mobile interface files
  - `/generated` - Generated audio files
- `server.js` - Main server file
- `package.json` - Project dependencies and scripts

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.

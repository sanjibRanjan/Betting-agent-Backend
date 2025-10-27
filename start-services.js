#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Cricket Betting Agent Services...');
console.log('📁 Root Directory:', process.cwd());
console.log('');

// Configuration
const NODE_PORT = 3000;
const PYTHON_PORT = 5001;
const ML_DIR = path.join(__dirname, 'ml_models');
const VENV_DIR = path.join(ML_DIR, 'ml_env');

let nodeProcess = null;
let pythonProcess = null;

// Function to start Node.js server
function startNodeServer() {
  console.log('🌐 Starting Node.js Server (Port 3000)...');
  
  nodeProcess = spawn('node', ['server.js'], {
    stdio: 'inherit',
    cwd: __dirname
  });

  nodeProcess.on('error', (err) => {
    console.error('❌ Node.js Server Error:', err.message);
  });

  nodeProcess.on('exit', (code) => {
    console.log(`📴 Node.js Server exited with code ${code}`);
    if (code !== 0) {
      console.error('❌ Node.js Server failed to start');
    }
  });

  return nodeProcess;
}

// Function to start Python ML service
function startPythonService() {
  console.log('🤖 Starting Python ML Service (Port 5001)...');
  
  // Check if ML directory and virtual environment exist
  const fs = require('fs');
  if (!fs.existsSync(ML_DIR)) {
    console.warn('⚠️  ML models directory not found:', ML_DIR);
    console.warn('⚠️  Skipping Python ML service startup');
    return null;
  }

  if (!fs.existsSync(VENV_DIR)) {
    console.warn('⚠️  Python virtual environment not found:', VENV_DIR);
    console.warn('⚠️  Skipping Python ML service startup');
    return null;
  }

  // Start Python service
  const pythonScript = `
import sys
import os
sys.path.append('${ML_DIR}')
os.chdir('${ML_DIR}')

try:
    from model_deployer import CricketPredictionService
    print('🚀 Initializing Cricket Prediction Service...')
    service = CricketPredictionService()
    print('✅ Service initialized successfully')
    print('🌐 Starting Flask server on port ${PYTHON_PORT}...')
    service.run_server(host='0.0.0.0', port=${PYTHON_PORT}, debug=False)
except Exception as e:
    print(f'❌ Error starting ML service: {e}')
    sys.exit(1)
`;

  pythonProcess = spawn('python3', ['-c', pythonScript], {
    stdio: 'inherit',
    cwd: ML_DIR,
    env: {
      ...process.env,
      PATH: `${VENV_DIR}/bin:${process.env.PATH}`
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('❌ Python ML Service Error:', err.message);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`📴 Python ML Service exited with code ${code}`);
    if (code !== 0) {
      console.error('❌ Python ML Service failed to start');
    }
  });

  return pythonProcess;
}

// Function to check if ports are available
function checkPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    
    server.listen(port, () => {
      server.once('close', () => {
        resolve(true);
      });
      server.close();
    });
    
    server.on('error', () => {
      resolve(false);
    });
  });
}

// Function to wait for services to be ready
async function waitForServices() {
  console.log('⏳ Waiting for services to start...');
  
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    const nodeReady = await checkPort(NODE_PORT);
    const pythonReady = pythonProcess ? await checkPort(PYTHON_PORT) : true;
    
    if (nodeReady && pythonReady) {
      console.log('✅ All services are ready!');
      break;
    }
    
    process.stdout.write('.');
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  console.log('');
  
  if (attempts >= maxAttempts) {
    console.warn('⚠️  Services may still be starting. Check the logs above.');
  }
}

// Function to show service URLs
function showServiceUrls() {
  console.log('');
  console.log('🎉 Services Started Successfully!');
  console.log('');
  console.log('🌐 Node.js Server (Main Application):');
  console.log(`   • Main App: http://localhost:${NODE_PORT}`);
  console.log(`   • Health Check: http://localhost:${NODE_PORT}/health`);
  console.log(`   • Live Matches: http://localhost:${NODE_PORT}/api/live-matches`);
  console.log(`   • WebSocket: ws://localhost:${NODE_PORT}/socket.io`);
  console.log('');
  
  if (pythonProcess) {
    console.log('🤖 Python ML Service (AI Engine):');
    console.log(`   • Health Check: http://localhost:${PYTHON_PORT}/health`);
    console.log(`   • Model Info: http://localhost:${PYTHON_PORT}/model_info`);
    console.log(`   • Predictions: http://localhost:${PYTHON_PORT}/predict/<target>`);
    console.log('');
  }
  
  console.log('💡 Press Ctrl+C to stop all services');
  console.log('');
}

// Function to cleanup on exit
function cleanup() {
  console.log('\n🛑 Shutting down services...');
  
  if (nodeProcess) {
    nodeProcess.kill('SIGTERM');
  }
  
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
  }
  
  setTimeout(() => {
    if (nodeProcess) {
      nodeProcess.kill('SIGKILL');
    }
    if (pythonProcess) {
      pythonProcess.kill('SIGKILL');
    }
    process.exit(0);
  }, 5000);
}

// Handle process signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Main execution
async function main() {
  try {
    // Start both services
    startNodeServer();
    
    // Wait a bit before starting Python service
    setTimeout(() => {
      startPythonService();
    }, 2000);
    
    // Wait for services to be ready
    await waitForServices();
    
    // Show service URLs
    showServiceUrls();
    
  } catch (error) {
    console.error('❌ Failed to start services:', error.message);
    cleanup();
  }
}

// Start the services
main();

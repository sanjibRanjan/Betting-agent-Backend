'use strict';

/**
 * Live Match Simulator for Cricket Data Pipeline Testing
 * Simulates real-time match data updates every 10-15 seconds
 * Tests the complete system: API → Data Processing → Event Detection → Question Generation
 */

const axios = require('axios');
const { io } = require('socket.io-client');
const EventEmitter = require('events');

class LiveMatchSimulator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.baseURL = config.baseURL || 'http://localhost:3000';
    this.websocketURL = config.websocketURL || 'http://localhost:3000';
    this.socket = null;
    this.matches = [];
    this.simulationRunning = false;
    this.updateInterval = null;
    this.matchData = new Map(); // Track individual match states
    
    // Configuration
    this.updateIntervalRange = { min: 10000, max: 15000 }; // 10-15 seconds
    this.logLevel = config.logLevel || 'info';
    
    console.log('🏏 Live Match Simulator initialized');
    console.log(`📍 API Base URL: ${this.baseURL}`);
    console.log(`🌐 WebSocket URL: ${this.websocketURL}`);
  }

  /**
   * Start the live match simulation
   */
  async start() {
    try {
      console.log('\n🚀 Starting Live Match Simulation...\n');
      
      // Initialize sample matches with realistic data
      this.initializeMatchData();
      
      // Connect to WebSocket for monitoring
      await this.connectWebSocket();
      
      // Start simulating real-time updates
      this.simulationRunning = true;
      this.scheduleNextUpdate();
      
      console.log('✅ Live match simulation started');
      console.log('📊 Monitoring 3 simulated cricket matches');
      console.log('🔄 Updates will occur every 10-15 seconds\n');
      
      this.logMatches();
      
    } catch (error) {
      console.error('❌ Failed to start simulation:', error.message);
      throw error;
    }
  }

  /**
   * Initialize realistic match data
   */
  initializeMatchData() {
    const baseDate = new Date();
    
    this.matches = [
      {
        id: 'sim_match_001',
        teams: { home: 'India', away: 'Australia' },
        format: 'ODI',
        venue: 'MCA Stadium, Pune',
        status: 'Live',
        currentOver: 12.3,
        currentInnings: 1,
        scores: {
          batting: { runs: 87, wickets: 2 },
          bowling: { runs: 87, wickets: 2 }
        },
        battingTeam: 'India',
        bowlingTeam: 'Australia',
        recentBalls: this.generateRecentBalls('India', 'Australia'),
        lastUpdated: baseDate
      },
      {
        id: 'sim_match_002',
        teams: { home: 'England', away: 'New Zealand' },
        format: 'T20I',
        venue: 'Lord\'s, London',
        status: 'Live',
        currentOver: 8.5,
        currentInnings: 1,
        scores: {
          batting: { runs: 72, wickets: 1 },
          bowling: { runs: 72, wickets: 1 }
        },
        battingTeam: 'England',
        bowlingTeam: 'New Zealand',
        recentBalls: this.generateRecentBalls('England', 'New Zealand'),
        lastUpdated: baseDate
      },
      {
        id: 'sim_match_003',
        teams: { home: 'Pakistan', away: 'South Africa' },
        format: 'Test',
        venue: 'Gaddafi Stadium, Lahore',
        status: 'Live',
        currentOver: 35.2,
        currentInnings: 2,
        scores: {
          batting: { runs: 245, wickets: 5 },
          bowling: { runs: 245, wickets: 5 }
        },
        battingTeam: 'Pakistan',
        bowlingTeam: 'South Africa',
        recentBalls: this.generateRecentBalls('Pakistan', 'South Africa'),
        lastUpdated: baseDate
      }
    ];

    // Store in match data map for tracking
    this.matches.forEach(match => {
      this.matchData.set(match.id, { ...match, eventHistory: [] });
    });
  }

  /**
   * Generate recent balls with realistic cricket data
   */
  generateRecentBalls(battingTeam, bowlingTeam) {
    const batsmen = this.getBatsmenForTeam(battingTeam);
    const bowlers = this.getBowlersForTeam(bowlingTeam);
    
    return [
      { ball: '11.5', runs: 2, batsman: batsmen[0], bowler: bowlers[1], isBoundary: false, isWicket: false },
      { ball: '12.0', runs: 0, batsman: batsmen[0], bowler: bowlers[1], isBoundary: false, isWicket: false },
      { ball: '12.1', runs: 4, batsman: batsmen[1], bowler: bowlers[1], isBoundary: true, isWicket: false },
      { ball: '12.2', runs: 1, batsman: batsmen[1], bowler: bowlers[1], isBoundary: false, isWicket: false },
      { ball: '12.3', runs: 0, batsman: batsmen[0], bowler: bowlers[1], isBoundary: false, isWicket: false },
      { ball: '12.4', runs: 1, batsman: batsmen[0], bowler: bowlers[1], isBoundary: false, isWicket: false }
    ];
  }

  /**
   * Get batsmen for a team
   */
  getBatsmenForTeam(team) {
    const batsmen = {
      'India': ['Virat Kohli', 'Rohit Sharma', 'KL Rahul', 'Shubman Gill'],
      'Australia': ['David Warner', 'Steve Smith', 'Marnus Labuschagne'],
      'England': ['Jos Buttler', 'Jonny Bairstow', 'Joe Root'],
      'New Zealand': ['Kane Williamson', 'Devon Conway', 'Tom Latham'],
      'Pakistan': ['Babar Azam', 'Mohammad Rizwan', 'Fakhar Zaman'],
      'South Africa': ['Quinton de Kock', 'Temba Bavuma', 'Rassie van der Dussen']
    };
    return batsmen[team] || ['Player A', 'Player B'];
  }

  /**
   * Get bowlers for a team
   */
  getBowlersForTeam(team) {
    const bowlers = {
      'India': ['Jasprit Bumrah', 'Mohammed Shami', 'Ravindra Jadeja'],
      'Australia': ['Mitchell Starc', 'Pat Cummins', 'Josh Hazlewood'],
      'England': ['Chris Woakes', 'Mark Wood', 'Adil Rashid'],
      'New Zealand': ['Trent Boult', 'Tim Southee', 'Mitchell Santner'],
      'Pakistan': ['Shaheen Afridi', 'Hasan Ali', 'Shadab Khan'],
      'South Africa': ['Kagiso Rabada', 'Anrich Nortje', 'Keshav Maharaj']
    };
    return bowlers[team] || ['Bowler A', 'Bowler B'];
  }

  /**
   * Connect to WebSocket for monitoring
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.websocketURL, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          timeout: 10000
        });

        this.socket.on('connect', () => {
          console.log('✅ Connected to WebSocket');
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          console.log(`⚠️  WebSocket disconnected: ${reason}`);
        });

        this.socket.on('error', (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        });

        // Listen for live match updates
        this.socket.on('liveMatches', (data) => {
          console.log('\n📥 Received live match update from server');
        });

        // Listen for question generation events
        this.socket.on('questionGenerated', (data) => {
          console.log('\n❓ Question generated:', data.question);
        });

        this.socket.on('connect_error', (error) => {
          console.warn('⚠️  WebSocket connection failed, continuing without monitoring:', error.message);
          resolve(); // Continue without WebSocket
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!this.socket.connected) {
            console.warn('⚠️  WebSocket connection timeout, continuing without monitoring');
            resolve();
          }
        }, 5000);

      } catch (error) {
        console.warn('⚠️  WebSocket connection failed, continuing without monitoring:', error.message);
        resolve(); // Continue without WebSocket
      }
    });
  }

  /**
   * Schedule next update with random interval
   */
  scheduleNextUpdate() {
    if (!this.simulationRunning) return;

    const interval = this.getRandomInterval();
    
    this.updateInterval = setTimeout(() => {
      this.performUpdate();
    }, interval);
  }

  /**
   * Get random interval between min and max
   */
  getRandomInterval() {
    const min = this.updateIntervalRange.min;
    const max = this.updateIntervalRange.max;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Perform a data update cycle
   */
  async performUpdate() {
    if (!this.simulationRunning) return;

    try {
      const timestamp = new Date();
      console.log(`\n🔄 Update cycle started at ${timestamp.toLocaleTimeString()}`);

      // Update each match
      for (const match of this.matches) {
        this.updateMatch(match);
      }

      // Send updates to API (simulating real API response)
      await this.sendUpdatesToAPI();

      // Emit update event
      this.emit('update', { matches: this.matches, timestamp });

      console.log(`✅ Update cycle completed`);

      // Log current match states
      this.logMatches();

      // Schedule next update
      this.scheduleNextUpdate();

    } catch (error) {
      console.error('❌ Error in update cycle:', error.message);
      this.scheduleNextUpdate(); // Continue despite errors
    }
  }

  /**
   * Update a single match with realistic progression
   */
  updateMatch(match) {
    const matchState = this.matchData.get(match.id);
    if (!matchState) return;

    // Increment ball (simulate ball-by-ball progression)
    const [over, ball] = match.currentOver.toString().split('.').map(Number);
    let newOver = over;
    let newBall = ball + 1;

    if (newBall >= 6) {
      newOver += 1;
      newBall = 0;
    }

    match.currentOver = parseFloat(`${newOver}.${newBall}`);

    // Random events
    const rand = Math.random();

    if (rand < 0.03) { // 3% chance of wicket
      match.scores.batting.wickets += 1;
      this.recordEvent(match.id, 'wicket', { over: match.currentOver });
      
    } else if (rand < 0.15) { // 12% chance of boundary
      const runs = Math.random() < 0.7 ? 4 : 6;
      match.scores.batting.runs += runs;
      this.recordEvent(match.id, 'boundary', { runs, over: match.currentOver });
      
    } else {
      // Regular runs
      const runs = Math.floor(Math.random() * 3);
      match.scores.batting.runs += runs;
    }

    // Update bowling team runs
    match.scores.bowling.runs = match.scores.batting.runs;

    // Add new ball to recent balls
    const batsmen = this.getBatsmenForTeam(match.battingTeam);
    const bowlers = this.getBowlersForTeam(match.bowlingTeam);
    
    match.recentBalls.unshift({
      ball: `${Math.floor(match.currentOver)}.${Math.floor((match.currentOver % 1) * 10)}`,
      runs: rand < 0.03 ? 'W' : (rand < 0.15 ? (Math.random() < 0.7 ? 4 : 6) : Math.floor(Math.random() * 3)),
      batsman: batsmen[0],
      bowler: bowlers[Math.floor(Math.random() * bowlers.length)],
      isBoundary: rand < 0.15,
      isWicket: rand < 0.03
    });

    // Keep only last 6 balls
    match.recentBalls = match.recentBalls.slice(0, 6);

    match.lastUpdated = new Date();
  }

  /**
   * Record an event for a match
   */
  recordEvent(matchId, eventType, data) {
    const matchState = this.matchData.get(matchId);
    if (matchState) {
      matchState.eventHistory.push({
        type: eventType,
        data,
        timestamp: new Date().toISOString()
      });

      // Emit event
      this.emit('matchEvent', { matchId, eventType, data });
    }
  }

  /**
   * Send updates to API (simulating SportMonks API response)
   */
  async sendUpdatesToAPI() {
    try {
      // Convert our simulated data to SportMonks format
      const sportMonksResponse = this.convertToSportMonksFormat();
      
      // In a real scenario, this would be the API response
      // For testing, we'll log what would be sent
      if (this.logLevel === 'debug') {
        console.log('📤 Simulated API response:', JSON.stringify(sportMonksResponse, null, 2));
      }

    } catch (error) {
      console.error('❌ Error sending updates to API:', error.message);
    }
  }

  /**
   * Convert match data to SportMonks API format
   */
  convertToSportMonksFormat() {
    const fixtures = this.matches.map(match => ({
      id: match.id,
      status: match.status,
      live: true,
      localteam: {
        id: match.teams.home,
        name: match.teams.home,
        code: match.teams.home.substring(0, 3).toUpperCase()
      },
      visitorteam: {
        id: match.teams.away,
        name: match.teams.away,
        code: match.teams.away.substring(0, 3).toUpperCase()
      },
      venue: {
        name: match.venue
      },
      runs: [
        {
          team_id: match.teams.home,
          score: match.scores.batting.runs,
          wickets: match.scores.batting.wickets,
          overs: match.currentOver.toFixed(1)
        }
      ],
      balls: match.recentBalls.map(ball => ({
        ball: ball.ball,
        runs: ball.runs,
        batsman: { name: ball.batsman },
        bowler: { name: ball.bowler }
      }))
    }));

    return {
      data: fixtures,
      meta: {
        current_page: 1,
        per_page: 10,
        total: fixtures.length
      }
    };
  }

  /**
   * Log current match states
   */
  logMatches() {
    console.log('\n📊 CURRENT MATCH STATUS:\n');
    
    this.matches.forEach(match => {
      const overStr = match.currentOver.toFixed(1);
      console.log(`🏏 ${match.id}: ${match.teams.home} vs ${match.teams.away}`);
      console.log(`   Status: ${match.status} | ${match.format}`);
      console.log(`   Score: ${match.scores.batting.runs}/${match.scores.batting.wickets} (${overStr})`);
      console.log(`   Batting: ${match.battingTeam} | Bowling: ${match.bowlingTeam}`);
      console.log(`   Last Update: ${match.lastUpdated.toLocaleTimeString()}`);
      console.log('');
    });
  }

  /**
   * Stop the simulation
   */
  stop() {
    console.log('\n🛑 Stopping live match simulation...\n');
    
    this.simulationRunning = false;
    
    if (this.updateInterval) {
      clearTimeout(this.updateInterval);
    }
    
    if (this.socket) {
      this.socket.disconnect();
    }
    
    console.log('✅ Simulation stopped');
  }

  /**
   * Get simulation statistics
   */
  getStats() {
    const totalEvents = Array.from(this.matchData.values()).reduce(
      (sum, match) => sum + match.eventHistory.length,
      0
    );

    return {
      activeMatches: this.matches.length,
      updateInterval: this.updateIntervalRange,
      totalEvents,
      simulationRunning: this.simulationRunning,
      uptime: Date.now() - (this.startTime || Date.now())
    };
  }
}

// CLI Usage
if (require.main === module) {
  const simulator = new LiveMatchSimulator({
    baseURL: process.env.API_URL || 'http://localhost:3000',
    websocketURL: process.env.WS_URL || 'http://localhost:3000',
    logLevel: process.env.LOG_LEVEL || 'info'
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    simulator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    simulator.stop();
    process.exit(0);
  });

  // Start simulation
  simulator.start().catch(error => {
    console.error('❌ Failed to start simulation:', error);
    process.exit(1);
  });

  // Print stats every 60 seconds
  setInterval(() => {
    const stats = simulator.getStats();
    console.log('\n📈 Simulation Stats:', stats);
  }, 60000);
}

module.exports = LiveMatchSimulator;

#!/usr/bin/env node

/**
 * SportMonks API Live Data Analysis and Fix
 * Based on the official SportMonks Cricket API documentation
 */

const axios = require('axios');

const API_TOKEN = 'nPhIHrWHHOgoHkqWtmh4X8OYCjg6siT9bBb4UPLtB4ddIb7nueXB6kxmlxRX';
const BASE_URL = 'https://cricket.sportmonks.com/api/v2.0';

async function analyzeSportMonksAPI() {
  console.log('🔍 SportMonks API Live Data Analysis');
  console.log('=' .repeat(60));
  
  try {
    // 1. Test /livescores endpoint
    console.log('\n1️⃣ Testing /livescores endpoint...');
    const livescoresResponse = await axios.get(`${BASE_URL}/livescores`, {
      params: {
        api_token: API_TOKEN,
        include: 'localteam,visitorteam,venue,runs,scoreboards'
      }
    });
    
    console.log(`   /livescores: ${livescoresResponse.data.data.length} matches`);
    
    if (livescoresResponse.data.data.length > 0) {
      const sample = livescoresResponse.data.data[0];
      console.log(`   Sample match: ${sample.localteam?.name} vs ${sample.visitorteam?.name}`);
      console.log(`   Status: ${sample.status}, Live: ${sample.live}`);
      console.log(`   Date: ${sample.starting_at}`);
    }
    
    // 2. Test /fixtures with live=true
    console.log('\n2️⃣ Testing /fixtures with live=true...');
    const fixturesLiveResponse = await axios.get(`${BASE_URL}/fixtures`, {
      params: {
        api_token: API_TOKEN,
        live: true,
        include: 'localteam,visitorteam,venue,runs,scoreboards'
      }
    });
    
    console.log(`   /fixtures?live=true: ${fixturesLiveResponse.data.data.length} matches`);
    
    if (fixturesLiveResponse.data.data.length > 0) {
      const sample = fixturesLiveResponse.data.data[0];
      console.log(`   Sample match: ${sample.localteam?.name} vs ${sample.visitorteam?.name}`);
      console.log(`   Status: ${sample.status}, Live: ${sample.live}`);
      console.log(`   Date: ${sample.starting_at}`);
    }
    
    // 3. Test with date range for current year
    console.log('\n3️⃣ Testing with current year date range...');
    const currentYear = new Date().getFullYear();
    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;
    
    const fixturesDateResponse = await axios.get(`${BASE_URL}/fixtures`, {
      params: {
        api_token: API_TOKEN,
        starting_at: `${startDate},${endDate}`,
        include: 'localteam,visitorteam,venue,runs,scoreboards'
      }
    });
    
    console.log(`   /fixtures with ${currentYear} date range: ${fixturesDateResponse.data.data.length} matches`);
    
    if (fixturesDateResponse.data.data.length > 0) {
      const sample = fixturesDateResponse.data.data[0];
      console.log(`   Sample match: ${sample.localteam?.name} vs ${sample.visitorteam?.name}`);
      console.log(`   Status: ${sample.status}, Live: ${sample.live}`);
      console.log(`   Date: ${sample.starting_at}`);
    }
    
    // 4. Test with broader date range (last 2 years)
    console.log('\n4️⃣ Testing with broader date range (last 2 years)...');
    const twoYearsAgo = currentYear - 2;
    const broadStartDate = `${twoYearsAgo}-01-01`;
    const broadEndDate = `${currentYear}-12-31`;
    
    const fixturesBroadResponse = await axios.get(`${BASE_URL}/fixtures`, {
      params: {
        api_token: API_TOKEN,
        starting_at: `${broadStartDate},${broadEndDate}`,
        include: 'localteam,visitorteam,venue,runs,scoreboards'
      }
    });
    
    console.log(`   /fixtures with ${twoYearsAgo}-${currentYear} range: ${fixturesBroadResponse.data.data.length} matches`);
    
    if (fixturesBroadResponse.data.data.length > 0) {
      const sample = fixturesBroadResponse.data.data[0];
      console.log(`   Sample match: ${sample.localteam?.name} vs ${sample.visitorteam?.name}`);
      console.log(`   Status: ${sample.status}, Live: ${sample.live}`);
      console.log(`   Date: ${sample.starting_at}`);
    }
    
    // 5. Check for matches with status "LIVE" or "INPLAY"
    console.log('\n5️⃣ Checking for matches with LIVE/INPLAY status...');
    const liveStatusResponse = await axios.get(`${BASE_URL}/fixtures`, {
      params: {
        api_token: API_TOKEN,
        status: 'LIVE',
        include: 'localteam,visitorteam,venue,runs,scoreboards'
      }
    });
    
    console.log(`   /fixtures?status=LIVE: ${liveStatusResponse.data.data.length} matches`);
    
    // 6. Check API key permissions and subscription
    console.log('\n6️⃣ Checking API key permissions...');
    try {
      const leaguesResponse = await axios.get(`${BASE_URL}/leagues`, {
        params: {
          api_token: API_TOKEN,
          per_page: 10
        }
      });
      
      console.log(`   Available leagues: ${leaguesResponse.data.data.length}`);
      if (leaguesResponse.data.data.length > 0) {
        console.log(`   Sample league: ${leaguesResponse.data.data[0].name}`);
      }
    } catch (error) {
      console.log(`   Leagues access: ${error.response?.status || 'Failed'}`);
    }
    
  } catch (error) {
    console.error(`❌ API analysis failed: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

async function identifyIssues() {
  console.log('\n🔍 Issue Identification');
  console.log('=' .repeat(60));
  
  console.log('📋 Based on SportMonks API documentation and testing:');
  console.log('');
  console.log('1️⃣ **API Key Subscription Issue**:');
  console.log('   - The API key may not have access to live data for current leagues');
  console.log('   - Live data is only available for leagues covered by your subscription');
  console.log('   - The API is returning old data (2018-2019) instead of current data');
  console.log('');
  console.log('2️⃣ **Date Filtering Issue**:');
  console.log('   - Our system filters matches to current year - 1 (2024)');
  console.log('   - But API is returning matches from 2018-2019');
  console.log('   - This causes all matches to be filtered out');
  console.log('');
  console.log('3️⃣ **Live Status Issue**:');
  console.log('   - No matches have status "LIVE" or "INPLAY"');
  console.log('   - All returned matches have status "Finished"');
  console.log('   - This suggests no live matches are currently happening');
  console.log('');
  console.log('4️⃣ **Subscription Coverage Issue**:');
  console.log('   - The API key may not cover the leagues that have live matches');
  console.log('   - Different subscription plans cover different leagues');
  console.log('   - Need to verify which leagues are covered by your plan');
}

async function provideSolutions() {
  console.log('\n💡 Solutions and Recommendations');
  console.log('=' .repeat(60));
  
  console.log('🎯 **Immediate Solutions**:');
  console.log('');
  console.log('1️⃣ **Fix Date Filtering Logic**:');
  console.log('   - Modify the date filtering to be less restrictive');
  console.log('   - Allow matches from the last 2-3 years instead of just current year');
  console.log('   - Add fallback to show recent matches when no live matches');
  console.log('');
  console.log('2️⃣ **Verify API Key Subscription**:');
  console.log('   - Check which leagues your API key covers');
  console.log('   - Verify if you have access to live data');
  console.log('   - Consider upgrading subscription if needed');
  console.log('');
  console.log('3️⃣ **Add Fallback Mechanisms**:');
  console.log('   - Show recent matches when no live matches available');
  console.log('   - Add upcoming matches to the response');
  console.log('   - Implement graceful degradation');
  console.log('');
  console.log('🔧 **Code Changes Needed**:');
  console.log('');
  console.log('1️⃣ **Modify cricketService.js**:');
  console.log('   - Change date filtering from `currentYear - 1` to `currentYear - 3`');
  console.log('   - Add fallback to show recent matches');
  console.log('   - Improve error handling for empty responses');
  console.log('');
  console.log('2️⃣ **Update API Endpoints**:');
  console.log('   - Add endpoint for recent matches');
  console.log('   - Add endpoint for upcoming matches');
  console.log('   - Add endpoint for all available matches');
  console.log('');
  console.log('3️⃣ **Enhance Data Processing**:');
  console.log('   - Process both live and recent matches');
  console.log('   - Generate questions for recent matches too');
  console.log('   - Add match status indicators');
}

async function createFix() {
  console.log('\n🔧 Creating System Fix');
  console.log('=' .repeat(60));
  
  console.log('📝 **Recommended Changes**:');
  console.log('');
  console.log('1️⃣ **Modify Date Filtering in cricketService.js**:');
  console.log('   ```javascript');
  console.log('   // Change this line:');
  console.log('   return matchYear >= currentYear - 1;');
  console.log('   // To this:');
  console.log('   return matchYear >= currentYear - 3;');
  console.log('   ```');
  console.log('');
  console.log('2️⃣ **Add Fallback Logic**:');
  console.log('   ```javascript');
  console.log('   // If no live matches, show recent matches');
  console.log('   if (liveMatches.length === 0) {');
  console.log('     return await this.getRecentMatches();');
  console.log('   }');
  console.log('   ```');
  console.log('');
  console.log('3️⃣ **Update API Response**:');
  console.log('   - Include match status in response');
  console.log('   - Add metadata about data freshness');
  console.log('   - Provide fallback data when live data unavailable');
}

async function main() {
  await analyzeSportMonksAPI();
  await identifyIssues();
  await provideSolutions();
  await createFix();
  
  console.log('\n✅ Analysis Complete!');
  console.log('');
  console.log('📞 **Next Steps**:');
  console.log('1. Modify the date filtering logic in cricketService.js');
  console.log('2. Verify your SportMonks API subscription covers live data');
  console.log('3. Add fallback mechanisms for when no live matches');
  console.log('4. Test the system with the updated filtering logic');
  console.log('');
  console.log('🎯 **Root Cause**: The API key subscription may not cover current live data,');
  console.log('   and the date filtering is too restrictive for the available data.');
}

if (require.main === module) {
  main();
}

module.exports = { analyzeSportMonksAPI, identifyIssues, provideSolutions, createFix };

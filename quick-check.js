#!/usr/bin/env node

const axios = require('axios');

async function checkAPIResponse() {
  try {
    console.log('🔍 Checking API Response Structure...\n');
    
    const response = await axios.get('http://localhost:5001/api/live-matches');
    const data = response.data;
    
    console.log('📊 API Response Analysis:');
    console.log('========================\n');
    
    if (Array.isArray(data)) {
      console.log('✅ Response is an array');
      console.log(`📈 Array length: ${data.length}\n`);
      
      let missingNameCount = 0;
      
      for (let i = 0; i < data.length; i++) {
        const obj = data[i];
        if (!obj.hasOwnProperty('name')) {
          missingNameCount++;
          console.log(`❌ ERROR: Object ${i + 1} is missing "name" property`);
          console.log(`   Available properties: ${Object.keys(obj).join(', ')}`);
          console.log(`   Full object:`, JSON.stringify(obj, null, 2));
          console.log('');
        }
      }
      
      console.log('📋 Summary:');
      console.log('===========');
      console.log(`Total objects: ${data.length}`);
      console.log(`Objects missing 'name' property: ${missingNameCount}`);
      
      if (missingNameCount > 0) {
        console.log('\n❌ ERROR: Some objects are missing the "name" property!');
      } else {
        console.log('\n✅ SUCCESS: All objects have the "name" property!');
      }
      
    } else {
      console.log('❌ ERROR: Response is not an array');
      console.log('Response type:', typeof data);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAPIResponse();

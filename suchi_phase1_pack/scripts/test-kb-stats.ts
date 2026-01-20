#!/usr/bin/env ts-node
/**
 * Test KB Stats Admin Endpoint
 */

import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || process.env.EVAL_API_BASE_URL || 'https://suchi-api-lxiveognla-uc.a.run.app/v1';
const ADMIN_USER = process.env.ADMIN_BASIC_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_BASIC_PASS || '';

async function testKBStats() {
  try {
    console.log('🧪 Testing /admin/kb-stats endpoint...\n');
    console.log(`📍 API URL: ${API_BASE_URL}`);
    console.log(`👤 Admin User: ${ADMIN_USER}`);
    console.log('');

    // Try without auth first to check if endpoint exists
    console.log('📡 Testing endpoint (first without auth to check if it exists)...\n');
    
    let response;
    try {
      // Try without auth - should get 401 if endpoint exists
      response = await axios.get(`${API_BASE_URL}/admin/kb-stats`, {
        timeout: 30000,
        validateStatus: () => true // Don't throw on any status
      });
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.error('❌ Cannot connect to API. Is it running?');
        process.exit(1);
      }
      throw error;
    }

    if (response.status === 404) {
      console.error('❌ Endpoint not found (404).');
      console.error('   The code changes need to be deployed to Cloud Run first.');
      console.error('   Run: npm run build (in apps/api) and deploy to Cloud Run');
      process.exit(1);
    }

    if (response.status === 401) {
      console.log('✅ Endpoint exists! (Got 401 - needs authentication)\n');
      
      if (!ADMIN_PASS) {
        console.error('❌ ADMIN_BASIC_PASS not set. Please set it as an environment variable.');
        console.error('   Example: $env:ADMIN_BASIC_PASS="your_password"');
        console.error('   Or get it from Secret Manager:');
        console.error('   gcloud secrets versions access latest --secret="admin-basic-pass"');
        process.exit(1);
      }

      // Retry with auth
      console.log('🔐 Retrying with authentication...\n');
      const credentials = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
      const authHeader = `Basic ${credentials}`;

      response = await axios.get(`${API_BASE_URL}/admin/kb-stats`, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
    }

    console.log('✅ Success! Response received:\n');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(response.data, null, 2));
    console.log('─'.repeat(60));
    console.log('');

    // Pretty print summary
    if (response.data.nci) {
      console.log('📊 NCI Summary:');
      console.log(`   Documents: ${response.data.nci.documents.toLocaleString()}`);
      console.log(`   Chunks: ${response.data.nci.chunks.toLocaleString()}`);
      console.log(`   Chunks with Embeddings: ${response.data.nci.chunksWithEmbeddings.toLocaleString()}`);
      console.log(`   Embedding %: ${response.data.nci.embeddingPercentage}%`);
      console.log('');
    }

    if (response.data.totals) {
      console.log('📈 Overall Totals:');
      console.log(`   Total Documents: ${response.data.totals.documents.toLocaleString()}`);
      console.log(`   Total Chunks: ${response.data.totals.chunks.toLocaleString()}`);
      console.log(`   Total Embedded: ${response.data.totals.chunksWithEmbeddings.toLocaleString()}`);
      console.log(`   NCI % of Total: ${response.data.totals.nciPercentage}%`);
      console.log('');
    }

  } catch (error: any) {
    if (error.response) {
      // HTTP error response
      console.error(`❌ HTTP Error: ${error.response.status} ${error.response.statusText}`);
      if (error.response.status === 401) {
        console.error('   Authentication failed. Check ADMIN_BASIC_USER and ADMIN_BASIC_PASS.');
      } else if (error.response.status === 404) {
        console.error('   Endpoint not found. The code may not be deployed yet.');
        console.error('   You need to build and deploy the API first.');
      } else {
        console.error(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    } else if (error.request) {
      console.error('❌ No response received. Check if the API is running.');
      console.error(`   URL: ${API_BASE_URL}/admin/kb-stats`);
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

testKBStats();

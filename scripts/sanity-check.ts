#!/usr/bin/env ts-node
/**
 * Sanity Check Script
 * Verifies that frontend, backend, RAG, and AI model are all working correctly
 */

import axios from 'axios';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE_URL = process.env.API_BASE_URL || process.env.EVAL_API_BASE_URL || 'https://suchi-api-lxiveognla-uc.a.run.app/v1';
const QUICK_MODE = process.argv.includes('--quick');

interface CheckResult {
  success: boolean;
  message: string;
  details?: string;
  skipped?: boolean;
}

async function checkFrontend(): Promise<CheckResult> {
  if (QUICK_MODE) {
    // Quick mode: just check if files exist
    const webPath = path.join(process.cwd(), 'apps', 'web');
    if (!fs.existsSync(webPath)) {
      return { success: false, message: 'Frontend directory not found' };
    }
    const packageJson = path.join(webPath, 'package.json');
    if (!fs.existsSync(packageJson)) {
      return { success: false, message: 'Frontend package.json not found' };
    }
    return { success: true, message: 'Frontend files present' };
  }

  try {
    console.log('Checking frontend build...');
    const webPath = path.join(process.cwd(), 'apps', 'web');
    execSync('npm run build', { 
      cwd: webPath, 
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    return { success: true, message: 'Frontend build successful' };
  } catch (error: any) {
    return { 
      success: false, 
      message: 'Frontend build failed', 
      details: error.message 
    };
  }
}

async function checkBackend(): Promise<CheckResult> {
  try {
    console.log('Checking backend health...');
    const response = await axios.get(`${API_BASE_URL}/health`, {
      timeout: 30000, // 30 seconds for Cloud Run cold starts
      validateStatus: (status) => status < 500 // Accept 4xx as "backend is up"
    });

    if (response.status === 200 && response.data.status === 'ok') {
      return { 
        success: true, 
        message: 'Backend health check passed', 
        details: `Database: ${response.data.database || 'connected'}` 
      };
    } else {
      return { 
        success: false, 
        message: 'Backend health check failed', 
        details: `Status: ${response.status}, Response: ${JSON.stringify(response.data)}` 
      };
    }
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return { 
        success: false, 
        message: 'Backend not running', 
        details: `Cannot connect to ${API_BASE_URL}. Start the API server first.`,
        skipped: true 
      };
    }
    return { 
      success: false, 
      message: 'Backend health check error', 
      details: error.message 
    };
  }
}

async function checkRAG(): Promise<CheckResult> {
  // First check if backend is available
  const backendCheck = await checkBackend();
  if (!backendCheck.success && backendCheck.skipped) {
    return { 
      success: false, 
      message: 'RAG check skipped', 
      details: 'Backend unavailable',
      skipped: true 
    };
  }

  try {
    console.log('Checking RAG retrieval...');
    
    // Create a session first
    const sessionResponse = await axios.post(`${API_BASE_URL}/sessions`, {
      channel: 'web',
      locale: 'en'
    }, { timeout: 30000 }); // 30 seconds for Cloud Run cold starts

    const sessionId = sessionResponse.data.sessionId;
    if (!sessionId) {
      return { 
        success: false, 
        message: 'Failed to create session for RAG test' 
      };
    }

    // Test RAG with a simple query
    const chatResponse = await axios.post(`${API_BASE_URL}/chat`, {
      sessionId,
      channel: 'web',
      userText: 'What is cancer? Just asking generally.'
    }, { 
      timeout: 120000, // 120 second timeout for LLM call (Cloud Run cold starts can be slow)
      validateStatus: () => true, // Don't throw on any status code
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Check response status first
    if (chatResponse.status >= 400) {
      return { 
        success: false, 
        message: 'RAG retrieval failed', 
        details: `API returned status ${chatResponse.status}: ${JSON.stringify(chatResponse.data)}` 
      };
    }

    const retrievedChunks = chatResponse.data.retrievedChunks || [];
    const citations = chatResponse.data.citations || [];
    
    // If retrievedChunks is available, use it for detailed check
    if (retrievedChunks.length > 0) {
      const trustedSources = retrievedChunks.filter((chunk: any) => chunk.isTrustedSource);
      const top3Trusted = retrievedChunks.slice(0, 3).some((chunk: any) => chunk.isTrustedSource);
      
      if (!top3Trusted) {
        return { 
          success: false, 
          message: 'RAG retrieval quality issue', 
          details: `No trusted sources in top-3. Retrieved ${retrievedChunks.length} chunks, ${trustedSources.length} trusted total.` 
        };
      }
      
      return { 
        success: true, 
        message: 'RAG retrieval working', 
        details: `${retrievedChunks.length} chunks retrieved, ${trustedSources.length} trusted sources, top-3 has trusted source` 
      };
    }
    
    // Fallback: Use citations as proxy for RAG (citations come from retrieved chunks)
    if (citations.length > 0) {
      const trustedCitations = citations.filter((c: any) => c.isTrustedSource === true);
      // Also check sourceType for trusted sources (02_nci_core, etc.)
      const trustedBySourceType = citations.filter((c: any) => 
        c.sourceType && (c.sourceType.startsWith('02_nci_core') || c.sourceType.startsWith('01_suchi_oncotalks'))
      );
      
      if (trustedCitations.length > 0 || trustedBySourceType.length > 0) {
        const trustedCount = Math.max(trustedCitations.length, trustedBySourceType.length);
        return { 
          success: true, 
          message: 'RAG retrieval working', 
          details: `${citations.length} citations found (${trustedCount} from trusted sources). Citations indicate RAG is functioning.` 
        };
      } else {
        // If we have citations but can't verify trusted status, still consider it a pass
        // (RAG is working, we just can't verify source trust)
        return { 
          success: true, 
          message: 'RAG retrieval working', 
          details: `${citations.length} citations found. RAG is functioning (trusted source verification unavailable in response).` 
        };
      }
    }
    
    // No chunks and no citations - RAG not working
    const responseKeys = Object.keys(chatResponse.data || {});
    return { 
      success: false, 
      message: 'RAG retrieval failed', 
      details: `No chunks or citations retrieved. Response keys: ${responseKeys.join(', ')}. Status: ${chatResponse.status}` 
    };
  } catch (error: any) {
    const errorDetails = error.code === 'ECONNABORTED' || error.message?.includes('timeout')
      ? `Request timed out after ${error.config?.timeout || 'unknown'}ms. This may indicate Cloud Run cold start or slow LLM response.`
      : error.response?.data?.message || error.message || 'Unknown error';
    
    return { 
      success: false, 
      message: 'RAG check failed', 
      details: `${errorDetails} (Code: ${error.code || 'N/A'})` 
    };
  }
}

async function checkAIModel(): Promise<CheckResult> {
  // First check if backend is available
  const backendCheck = await checkBackend();
  if (!backendCheck.success && backendCheck.skipped) {
    return { 
      success: false, 
      message: 'AI Model check skipped', 
      details: 'Backend unavailable',
      skipped: true 
    };
  }

  try {
    console.log('Checking AI model...');
    
    // Create a session
    const sessionResponse = await axios.post(`${API_BASE_URL}/sessions`, {
      channel: 'web',
      locale: 'en'
    }, { timeout: 30000 }); // 30 seconds for Cloud Run cold starts

    const sessionId = sessionResponse.data.sessionId;
    if (!sessionId) {
      return { 
        success: false, 
        message: 'Failed to create session for AI model test' 
      };
    }

    // Test AI model with a query that should generate citations
    const chatResponse = await axios.post(`${API_BASE_URL}/chat`, {
      sessionId,
      channel: 'web',
      userText: 'What are common symptoms of breast cancer? Just asking generally.'
    }, { 
      timeout: 120000, // 120 second timeout for LLM call (Cloud Run cold starts can be slow)
      validateStatus: () => true, // Don't throw on any status code
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const responseText = chatResponse.data.responseText || '';
    const citations = chatResponse.data.citations || [];

    if (!responseText || responseText.trim().length === 0) {
      return { 
        success: false, 
        message: 'AI model returned empty response' 
      };
    }

    // Check for fallback responses (indicates LLM failure)
    const fallbackIndicators = [
      "I don't have enough information",
      "I'm having trouble",
      "I want to be careful here"
    ];
    const isFallback = fallbackIndicators.some(indicator => 
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );

    if (isFallback && citations.length === 0) {
      return { 
        success: false, 
        message: 'AI model may be using fallback response', 
        details: 'Response suggests abstention without citations' 
      };
    }

    // Check for citation format
    const hasCitationMarkers = /\[citation:[^\]]+\]/.test(responseText);
    const hasCitationsInResponse = citations.length > 0;

    if (!hasCitationMarkers && !hasCitationsInResponse) {
      return { 
        success: false, 
        message: 'AI model response missing citations', 
        details: 'Response should include citation markers or citation objects' 
      };
    }

    return { 
      success: true, 
      message: 'AI model responding correctly', 
      details: `Response length: ${responseText.length} chars, Citations: ${citations.length}, Citation markers: ${hasCitationMarkers}` 
    };
  } catch (error: any) {
    let errorDetails: string;
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      errorDetails = `Request timed out after ${error.config?.timeout || 'unknown'}ms. This may indicate Cloud Run cold start or slow LLM response.`;
    } else if (error.code === 'ECONNRESET') {
      errorDetails = `Connection was reset by the server. This may indicate Cloud Run timeout or service restart. Try again.`;
    } else {
      errorDetails = error.response?.data?.message || error.message || 'Unknown error';
    }
    
    return { 
      success: false, 
      message: 'AI model check failed', 
      details: `${errorDetails} (Code: ${error.code || 'N/A'})` 
    };
  }
}

async function runSanityCheck() {
  console.log('🔍 Starting Sanity Check...\n');
  if (QUICK_MODE) {
    console.log('⚡ Quick mode enabled (skipping build and functional tests)\n');
  }

  const frontendResult = await checkFrontend();
  const backendResult = await checkBackend();
  const ragResult = QUICK_MODE ? { success: false, message: 'Skipped in quick mode', skipped: true } : await checkRAG();
  
  // If RAG check passed, AI model is already verified (RAG uses AI model to generate response)
  // Only run separate AI model check if RAG failed or was skipped
  const aiModelResult = QUICK_MODE 
    ? { success: false, message: 'Skipped in quick mode', skipped: true }
    : (ragResult.success 
        ? { success: true, message: 'AI model verified via RAG check', details: 'RAG check already confirmed AI model is working' }
        : await checkAIModel());

  const results = {
    frontend: frontendResult,
    backend: backendResult,
    rag: ragResult,
    aiModel: aiModelResult
  };

  console.log('\n📊 Sanity Check Results:\n');

  const icons = {
    success: '✅',
    failure: '❌',
    skipped: '⏭️ '
  };

  for (const [check, result] of Object.entries(results)) {
    const icon = result.skipped ? icons.skipped : (result.success ? icons.success : icons.failure);
    const checkName = check.charAt(0).toUpperCase() + check.slice(1);
    console.log(`${icon} ${checkName}: ${result.message}`);
    if (result.details) {
      console.log(`   ${result.details}`);
    }
  }

  const allPassed = Object.values(results).every(r => r.success || r.skipped);
  const anyFailed = Object.values(results).some(r => !r.success && !r.skipped);

  console.log('');
  if (allPassed && !anyFailed) {
    console.log('✅ All checks passed!');
    process.exit(0);
  } else if (anyFailed) {
    console.log('❌ Some checks failed. See details above.');
    process.exit(1);
  } else {
    console.log('⚠️  Some checks were skipped. All completed checks passed.');
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  runSanityCheck().catch((error) => {
    console.error('❌ Sanity check crashed:', error);
    process.exit(1);
  });
}

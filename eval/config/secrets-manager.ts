/**
 * Google Cloud Secrets Manager integration
 * Fetches API keys securely from GCP Secret Manager
 */

let secretsClient: any = null;

/**
 * Initialize Secrets Manager client (lazy loading)
 */
async function getSecretsClient() {
  if (secretsClient) {
    return secretsClient;
  }

  try {
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    secretsClient = new SecretManagerServiceClient();
    return secretsClient;
  } catch (error: any) {
    if (error.message?.includes("Cannot find module")) {
      throw new Error(
        "Google Cloud Secret Manager SDK not installed. Run: npm install @google-cloud/secret-manager"
      );
    }
    throw error;
  }
}

/**
 * Get secret value from Google Cloud Secret Manager
 */
export async function getSecret(
  secretName: string,
  projectId?: string,
  version: string = "latest"
): Promise<string | null> {
  try {
    const client = await getSecretsClient();
    const project = projectId || process.env.GOOGLE_CLOUD_PROJECT;
    
    if (!project) {
      console.warn("GOOGLE_CLOUD_PROJECT not set, skipping Secret Manager");
      return null;
    }

    const name = `projects/${project}/secrets/${secretName}/versions/${version}`;
    
    const [version_response] = await client.accessSecretVersion({ name });
    const secretValue = version_response.payload?.data?.toString();
    
    return secretValue || null;
  } catch (error: any) {
    // If secret doesn't exist or access is denied, return null
    // This allows fallback to environment variables
    if (error.code === 5 || error.code === 7) {
      // NOT_FOUND or PERMISSION_DENIED
      console.warn(`Secret ${secretName} not found or access denied: ${error.message}`);
      return null;
    }
    throw error;
  }
}

/**
 * Get multiple secrets in parallel
 */
export async function getSecrets(
  secretNames: string[],
  projectId?: string,
  version: string = "latest"
): Promise<Record<string, string | null>> {
  const results = await Promise.all(
    secretNames.map(async (name) => ({
      name,
      value: await getSecret(name, projectId, version),
    }))
  );

  return results.reduce((acc, { name, value }) => {
    acc[name] = value;
    return acc;
  }, {} as Record<string, string | null>);
}

/**
 * Check if Secret Manager is available
 */
export async function isSecretManagerAvailable(): Promise<boolean> {
  try {
    await getSecretsClient();
    return !!process.env.GOOGLE_CLOUD_PROJECT;
  } catch {
    return false;
  }
}






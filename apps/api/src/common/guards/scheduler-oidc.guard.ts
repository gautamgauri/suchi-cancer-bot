import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

/**
 * OIDC Guard for Cloud Scheduler
 *
 * Validates OIDC ID tokens sent by Cloud Scheduler.
 * This is the secure way to authenticate scheduled jobs on a public Cloud Run service.
 *
 * Required env vars:
 *   SCHEDULER_OIDC_AUDIENCE - The Cloud Run service URL (e.g., https://suchi-api-xxx.a.run.app)
 *   SCHEDULER_SA_EMAIL - The scheduler service account email (e.g., suchi-scheduler@project.iam.gserviceaccount.com)
 */
@Injectable()
export class SchedulerOidcGuard implements CanActivate {
  private readonly logger = new Logger(SchedulerOidcGuard.name);
  private readonly client = new OAuth2Client();

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;

    // Check for Bearer token
    if (!auth?.startsWith('Bearer ')) {
      this.logger.warn('Missing Bearer token in Authorization header');
      throw new UnauthorizedException('Missing Bearer token');
    }

    const idToken = auth.slice('Bearer '.length).trim();

    // Get expected values from environment
    const expectedAudience = process.env.SCHEDULER_OIDC_AUDIENCE;
    const expectedEmail = process.env.SCHEDULER_SA_EMAIL;

    if (!expectedAudience || !expectedEmail) {
      this.logger.error(
        'OIDC guard misconfigured - missing SCHEDULER_OIDC_AUDIENCE or SCHEDULER_SA_EMAIL',
      );
      throw new UnauthorizedException('OIDC guard misconfigured');
    }

    try {
      // Verify the token with Google
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: expectedAudience,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        this.logger.warn('Invalid token payload - empty');
        throw new UnauthorizedException('Invalid token payload');
      }

      // Validate issuer
      const issOk =
        payload.iss === 'https://accounts.google.com' ||
        payload.iss === 'accounts.google.com';
      if (!issOk) {
        this.logger.warn(`Invalid issuer: ${payload.iss}`);
        throw new UnauthorizedException('Invalid issuer');
      }

      // Validate caller email
      if (payload.email !== expectedEmail) {
        this.logger.warn(
          `Invalid caller email: ${payload.email}, expected: ${expectedEmail}`,
        );
        throw new UnauthorizedException('Invalid caller');
      }

      // Validate email is verified
      if (payload.email_verified !== true) {
        this.logger.warn('Email not verified');
        throw new UnauthorizedException('Email not verified');
      }

      this.logger.log(`OIDC auth successful for ${payload.email}`);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`OIDC token verification failed: ${error.message}`);
      throw new UnauthorizedException('Token verification failed');
    }
  }
}

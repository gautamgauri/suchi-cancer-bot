import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ActivityRegistryService {
  private readonly logger = new Logger(ActivityRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** List all program activities, optionally filtered by programArea or capability */
  async listActivities(filters?: {
    programArea?: string;
    capabilityId?: string;
    orgId?: string;
  }) {
    const where: Record<string, unknown> = { isActive: true };
    if (filters?.programArea) where.programArea = filters.programArea;
    if (filters?.orgId) where.orgId = filters.orgId;

    if (filters?.capabilityId) {
      return this.prisma.programActivity.findMany({
        where: {
          ...where,
          capabilities: {
            some: { capability: { capabilityId: filters.capabilityId } },
          },
        },
        include: {
          capabilities: {
            include: { capability: { select: { capabilityId: true, name: true } } },
          },
        },
        orderBy: { activityName: "asc" },
      });
    }

    return this.prisma.programActivity.findMany({
      where,
      include: {
        capabilities: {
          include: { capability: { select: { capabilityId: true, name: true } } },
        },
      },
      orderBy: { activityName: "asc" },
    });
  }

  /** Get activity detail with instances and capabilities */
  async getActivity(activityId: string) {
    return this.prisma.programActivity.findUnique({
      where: { activityId },
      include: {
        capabilities: {
          include: { capability: true },
          orderBy: { strength: "desc" },
        },
        instances: {
          orderBy: { reportDate: "desc" },
          take: 10,
        },
      },
    });
  }

  /** List fortnightly reports with optional center/date filters */
  async listInstances(filters?: {
    center?: string;
    program?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters?.center) where.center = { contains: filters.center };
    if (filters?.program) where.program = filters.program;
    if (filters?.fromDate || filters?.toDate) {
      where.reportDate = {
        ...(filters.fromDate && { gte: filters.fromDate }),
        ...(filters.toDate && { lte: filters.toDate }),
      };
    }

    return this.prisma.activityInstance.findMany({
      where,
      orderBy: { reportDate: "desc" },
      take: filters?.limit || 50,
    });
  }

  /** Get the month-wise plan with all weeks */
  async getPlan(planId?: string) {
    if (planId) {
      return this.prisma.programPlan.findUnique({
        where: { id: planId },
        include: {
          months: {
            orderBy: { monthNumber: "asc" },
            include: {
              weeks: { orderBy: { weekNumber: "asc" } },
            },
          },
        },
      });
    }

    // Default: return first active plan
    return this.prisma.programPlan.findFirst({
      where: { isActive: true },
      include: {
        months: {
          orderBy: { monthNumber: "asc" },
          include: {
            weeks: { orderBy: { weekNumber: "asc" } },
          },
        },
      },
    });
  }

  /** Get a single month's plan with weeks */
  async getPlanMonth(planId: string, monthNumber: number) {
    return this.prisma.programPlanMonth.findUnique({
      where: { planId_monthNumber: { planId, monthNumber } },
      include: {
        weeks: { orderBy: { weekNumber: "asc" } },
      },
    });
  }

  /**
   * Build activitiesContext string for the proposal planner.
   * Aggregates ProgramActivity data with latest metrics from ActivityInstance.
   */
  async buildActivitiesContext(orgId?: string): Promise<string> {
    const activities = await this.prisma.programActivity.findMany({
      where: { isActive: true, ...(orgId && { orgId }) },
      include: {
        capabilities: {
          include: { capability: { select: { capabilityId: true, name: true } } },
          where: { isPrimary: true },
        },
        instances: {
          orderBy: { reportDate: "desc" },
          take: 1,
        },
      },
      orderBy: { programArea: "asc" },
    });

    if (activities.length === 0) return "";

    const lines: string[] = ["PROGRAM ACTIVITIES REGISTRY:"];

    for (const act of activities) {
      const caps = act.capabilities.map(c => c.capability.name).join(", ");
      const latest = act.instances[0];

      let metricsLine = "";
      if (latest) {
        const metrics: string[] = [];
        if (latest.enrollmentTotal) metrics.push(`enrollment: ${latest.enrollmentTotal}`);
        if (latest.attendancePercent) metrics.push(`attendance: ${latest.attendancePercent}%`);
        if (latest.mealsServed) metrics.push(`meals/fortnight: ${latest.mealsServed}`);
        if (latest.kaActiveStudents) metrics.push(`KA students: ${latest.kaActiveStudents}`);
        if (latest.selSessions) metrics.push(`SEL sessions: ${latest.selSessions}`);
        if (metrics.length > 0) {
          metricsLine = ` | Latest metrics (${latest.reportingPeriod}): ${metrics.join(", ")}`;
        }
      }

      lines.push(
        `- ${act.activityName} [${act.programArea}]: ${act.description.substring(0, 120)}` +
        (act.frequency ? ` | Freq: ${act.frequency}` : "") +
        (act.centers.length > 0 ? ` | Centers: ${act.centers.join(", ")}` : "") +
        (caps ? ` | Capabilities: ${caps}` : "") +
        metricsLine
      );
    }

    return lines.join("\n");
  }
}
